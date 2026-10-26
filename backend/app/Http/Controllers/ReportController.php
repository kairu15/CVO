<?php

namespace App\Http\Controllers;

use App\Http\Requests\ReportChartRequest;
use App\Http\Requests\ReportRequest;
use App\Http\Requests\ReportTemplateExportRequest;
use App\Services\AuditLogger;
use App\Services\ReportChartService;
use App\Services\ReportExcelService;
use App\Services\ReportService;
use App\Services\ReportTemplateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * City-wide program report — admin-only, read-only, entirely derived.
 *
 * There is no store/update/destroy: a report is a question asked of the
 * recorded data, and the only way to change the answer is to change the
 * records. See ReportService for what is aggregated and why there is no
 * report table.
 *
 * The chart endpoints below are the Reports screen's five visualisations,
 * ONE DEDICATED AGGREGATION ENDPOINT EACH (see ReportChartService): the
 * database computes the aggregate, the SPA renders it — no raw rows are ever
 * shipped for the client to count.
 */
class ReportController extends Controller
{
    public function __construct(
        private readonly ReportService $reports,
        private readonly ReportExcelService $excel,
        private readonly ReportTemplateService $templates,
        private readonly ReportChartService $charts,
        private readonly AuditLogger $audit,
    ) {}

    public function index(ReportRequest $request): JsonResponse
    {
        $validated = $request->validated();

        return response()->json([
            'data' => $this->reports->cityWide(
                $request->user(),
                $validated['barangay'] ?? null,
                isset($validated['from']) ? Carbon::parse($validated['from']) : null,
            ),
        ]);
    }

    /**
     * The same report as a spreadsheet, scoped by the same filters — so the
     * numbers behind the charts are available as a file, not only on screen.
     */
    public function export(ReportRequest $request): StreamedResponse
    {
        $validated = $request->validated();

        // Data OUT: one row per report download, with the filters it used.
        $this->audit->log($request->user(), 'exported', null, [
            'resource' => 'city_report',
            'filters' => array_filter([
                'barangay' => $validated['barangay'] ?? null,
                'from' => isset($validated['from']) ? (string) $validated['from'] : null,
            ], static fn (?string $value): bool => $value !== null),
        ]);

        return $this->excel->downloadResponse(
            $request->user(),
            $validated['barangay'] ?? null,
            isset($validated['from']) ? Carbon::parse($validated['from']) : null,
        );
    }

    /**
     * The office's own printable report, filled from the recorded dispersals.
     *
     * Unlike export() above — a plain workbook of the aggregates — this is the
     * CVO cover sheet with its letterhead and signature block, plus the
     * dispersal roster between them, under the admin's editable report name.
     */
    public function exportFromTemplate(ReportTemplateExportRequest $request): BinaryFileResponse
    {
        $v = $request->validated();

        // Data OUT: the office's own template, named by the requester.
        $this->audit->log($request->user(), 'exported', null, [
            'resource' => 'report_template',
            'filters' => array_filter([
                'template' => $v['template'],
                'report_name' => $v['name'],
                'barangay' => $v['barangay'] ?? null,
                'animal_type' => $v['animal_type'] ?? null,
                'month' => $v['month'] ?? null,
                'from' => $v['from'] ?? null,
                'to' => $v['to'] ?? null,
            ], static fn (?string $value): bool => $value !== null),
        ]);

        return $this->templates->downloadResponse(
            $request->user(),
            $v['template'],
            $v['name'],
            $v['barangay'] ?? null,
            $v['month'] ?? null,
            isset($v['from']) ? Carbon::parse($v['from']) : null,
            isset($v['to']) ? Carbon::parse($v['to']) : null,
            $v['animal_type'] ?? null,
        );
    }

    /** Chart 1 — dispersal trend over time (line). */
    public function dispersalTrend(ReportChartRequest $request): JsonResponse
    {
        $v = $request->validated();

        return response()->json(['data' => $this->charts->dispersalTrend(
            $v['barangay'] ?? null,
            $v['animal_type'] ?? null,
            $v['from'] ?? null,
            $v['to'] ?? null,
        )]);
    }

    /** Chart 2 — animals dispersed by barangay (bar). */
    public function animalsByBarangay(ReportChartRequest $request): JsonResponse
    {
        $v = $request->validated();

        return response()->json(['data' => $this->charts->animalsByBarangay(
            $v['animal_type'] ?? null,
            $v['from'] ?? null,
            $v['to'] ?? null,
        )]);
    }

    /** Chart 3 — vaccination compliance over time (line). */
    public function vaccinationCompliance(ReportChartRequest $request): JsonResponse
    {
        $v = $request->validated();

        return response()->json(['data' => $this->charts->vaccinationCompliance(
            $v['barangay'] ?? null,
            $v['animal_type'] ?? null,
        )]);
    }

    /** Chart 4 — animal type distribution (donut). */
    public function animalTypeDistribution(ReportChartRequest $request): JsonResponse
    {
        $v = $request->validated();

        return response()->json(['data' => $this->charts->animalTypeDistribution(
            $v['month'] ?? null,
            $v['from'] ?? null,
            $v['to'] ?? null,
        )]);
    }

    /** Chart 5 — technician workload (bar). */
    public function technicianWorkload(ReportChartRequest $request): JsonResponse
    {
        $v = $request->validated();

        return response()->json(['data' => $this->charts->technicianWorkload(
            $v['barangay'] ?? null,
        )]);
    }
}
