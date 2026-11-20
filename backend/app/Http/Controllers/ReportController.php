<?php

namespace App\Http\Controllers;

use App\Http\Requests\ReportChartRequest;
use App\Http\Requests\ReportRequest;
use App\Models\ActivityLog;
use App\Http\Requests\ReportTemplateExportRequest;
use App\Services\AuditLogger;
use App\Services\FieldVisitVerificationService;
use App\Services\ReportChartService;
use App\Services\ReportExcelService;
use App\Services\ReportService;
use App\Services\ReportTemplateService;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
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
    /**
     * How long an aggregate answer is reused. These are READ-ONLY sums over
     * every record in the system: minutes of staleness never change a program
     * decision, while recomputing them for every visit (and every admin) is
     * the single most expensive thing the API does. The Reports page itself
     * polls the summary every 30s, so that one gets a shorter window.
     */
    private const CHART_CACHE_SECONDS = 60;
    private const REPORT_CACHE_SECONDS = 30;

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
            'data' => $this->cached(
                'summary',
                // The viewer rides in the key: scopeQueryFor can narrow the
                // report to the caller's own barangays.
                [
                    'viewer' => $request->user()->id,
                    'barangay' => $validated['barangay'] ?? null,
                    'from' => $validated['from'] ?? null,
                    'to' => $validated['to'] ?? null,
                    'category' => $validated['category'] ?? null,
                    'animal_type' => $validated['animal_type'] ?? null,
                    'beneficiary' => $validated['beneficiary'] ?? null,
                    'dispersal_type' => $validated['dispersal_type'] ?? null,
                ],
                fn (): array => $this->reports->cityWide(
                    $request->user(),
                    $validated['barangay'] ?? null,
                    isset($validated['from']) ? Carbon::parse($validated['from']) : null,
                    isset($validated['to']) ? Carbon::parse($validated['to']) : null,
                    $validated['category'] ?? null,
                    $validated['animal_type'] ?? null,
                    $validated['beneficiary'] ?? null,
                    $validated['dispersal_type'] ?? null,
                ),
                self::REPORT_CACHE_SECONDS,
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
                'category' => $validated['category'] ?? null,
                'animal_type' => $validated['animal_type'] ?? null,
                'beneficiary' => $validated['beneficiary'] ?? null,
                'dispersal_type' => $validated['dispersal_type'] ?? null,
                'from' => isset($validated['from']) ? (string) $validated['from'] : null,
                'to' => isset($validated['to']) ? (string) $validated['to'] : null,
            ], static fn (?string $value): bool => $value !== null),
        ]);

        return $this->excel->downloadResponse(
            $request->user(),
            $validated['barangay'] ?? null,
            isset($validated['from']) ? Carbon::parse($validated['from']) : null,
            isset($validated['to']) ? Carbon::parse($validated['to']) : null,
            $validated['category'] ?? null,
            $validated['animal_type'] ?? null,
            $validated['beneficiary'] ?? null,
            $validated['dispersal_type'] ?? null,
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
                'category' => $v['category'] ?? null,
                'beneficiary' => $v['beneficiary'] ?? null,
                'dispersal_type' => $v['dispersal_type'] ?? null,
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
            $v['category'] ?? null,
            $v['beneficiary'] ?? null,
            $v['dispersal_type'] ?? null,
        );
    }

    /** Chart 1 — dispersal trend over time (line). */
    public function dispersalTrend(ReportChartRequest $request): JsonResponse
    {
        $v = $request->validated();

        return response()->json(['data' => $this->cached(
            'dispersal-trend',
            [
                'barangay' => $v['barangay'] ?? null,
                'animal_type' => $v['animal_type'] ?? null,
                'category' => $v['category'] ?? null,
                'beneficiary' => $v['beneficiary'] ?? null,
                'dispersal_type' => $v['dispersal_type'] ?? null,
                'from' => $v['from'] ?? null,
                'to' => $v['to'] ?? null,
            ],
            fn (): array => $this->charts->dispersalTrend(
                $v['barangay'] ?? null,
                $v['animal_type'] ?? null,
                $v['from'] ?? null,
                $v['to'] ?? null,
                $v['category'] ?? null,
                $v['beneficiary'] ?? null,
                $v['dispersal_type'] ?? null,
            ),
            self::CHART_CACHE_SECONDS,
        )]);
    }

    /** Chart 2 — animals dispersed by barangay (bar). */
    public function animalsByBarangay(ReportChartRequest $request): JsonResponse
    {
        $v = $request->validated();

        return response()->json(['data' => $this->cached(
            'animals-by-barangay',
            [
                'animal_type' => $v['animal_type'] ?? null,
                'category' => $v['category'] ?? null,
                'beneficiary' => $v['beneficiary'] ?? null,
                'dispersal_type' => $v['dispersal_type'] ?? null,
                'from' => $v['from'] ?? null,
                'to' => $v['to'] ?? null,
            ],
            fn (): array => $this->charts->animalsByBarangay(
                $v['animal_type'] ?? null,
                $v['from'] ?? null,
                $v['to'] ?? null,
                $v['category'] ?? null,
                $v['beneficiary'] ?? null,
                $v['dispersal_type'] ?? null,
            ),
            self::CHART_CACHE_SECONDS,
        )]);
    }

    /** Chart 3 — vaccination compliance over time (line). */
    public function vaccinationCompliance(ReportChartRequest $request): JsonResponse
    {
        $v = $request->validated();

        return response()->json(['data' => $this->cached(
            'vaccination-compliance',
            [
                'barangay' => $v['barangay'] ?? null,
                'animal_type' => $v['animal_type'] ?? null,
                'beneficiary' => $v['beneficiary'] ?? null,
            ],
            fn (): array => $this->charts->vaccinationCompliance(
                $v['barangay'] ?? null,
                $v['animal_type'] ?? null,
                null,
                $v['beneficiary'] ?? null,
            ),
            self::CHART_CACHE_SECONDS,
        )]);
    }

    /** Chart 4 — animal type distribution (donut). */
    public function animalTypeDistribution(ReportChartRequest $request): JsonResponse
    {
        $v = $request->validated();

        return response()->json(['data' => $this->cached(
            'animal-type-distribution',
            [
                'month' => $v['month'] ?? null,
                'from' => $v['from'] ?? null,
                'to' => $v['to'] ?? null,
                'beneficiary' => $v['beneficiary'] ?? null,
            ],
            fn (): array => $this->charts->animalTypeDistribution(
                $v['month'] ?? null,
                $v['from'] ?? null,
                $v['to'] ?? null,
                $v['beneficiary'] ?? null,
            ),
            self::CHART_CACHE_SECONDS,
        )]);
    }

    /** Chart 5 — technician workload (bar). */
    public function technicianWorkload(ReportChartRequest $request): JsonResponse
    {
        $v = $request->validated();

        return response()->json(['data' => $this->cached(
            'technician-workload',
            ['barangay' => $v['barangay'] ?? null, 'beneficiary' => $v['beneficiary'] ?? null],
            fn (): array => $this->charts->technicianWorkload(
                $v['barangay'] ?? null,
                $v['beneficiary'] ?? null,
            ),
            self::CHART_CACHE_SECONDS,
        )]);
    }

    /**
     * The most recent report exports, taken from the immutable audit trail.
     * No report table is needed: the audit row already records the resource,
     * filters and reader. Only the last eight are returned.
     */
    public function recentExports(ReportChartRequest $request): JsonResponse
    {
        $labels = [
            'city_report' => 'Program report',
            'report_template' => 'Livestock dispersal report',
            'barangay_dispersal_analytics' => 'Barangay dispersal analytics',
        ];

        $rows = ActivityLog::query()
            ->where('action', 'exported')
            ->whereIn('new_values->resource', array_keys($labels))
            ->latest('created_at')
            ->latest('id')
            ->limit(8)
            ->get();

        return response()->json(['data' => $rows->map(function (ActivityLog $row) use ($labels): array {
            $values = $row->new_values ?? [];
            $resource = (string) ($values['resource'] ?? '');
            $filters = is_array($values['filters'] ?? null) ? $values['filters'] : [];

            return [
                'id' => $row->id,
                'category' => $labels[$resource] ?? 'Report',
                'resource' => $resource,
                'title' => $values['report_name'] ?? ($labels[$resource] ?? 'Report'),
                'filters' => $filters,
                'actor' => $row->actor_name,
                'generated_at' => $row->created_at?->toIso8601String(),
            ];
        })->values()]);
    }

    /**
     * Reuse an expensive aggregate for a short window, keyed by the filters
     * that produced it. The cache store is the app's own (file on the single
     * production instance), so this saves the database round trips even when
     * the store itself is not in memory.
     *
     * @param  array<string, mixed>  $filters
     * @param  Closure(): array<string, mixed>  $build
     * @return array<string, mixed>
     */
    /**
     * Off-site / needs-review counts for the Reports screen (Feature 1).
     *
     * The grouped COUNT lives in FieldVisitVerificationService::summaryCounts()
     * — the admin dashboard overview reads the same numbers, so the two
     * surfaces can never disagree. `threshold_m` is stated alongside so the
     * reader knows what "off site" meant today.
     */
    public function verificationSummary(ReportChartRequest $request): JsonResponse
    {
        $summary = $this->cached(
            'verification-summary',
            [],
            fn (): array => app(FieldVisitVerificationService::class)->summaryCounts(),
            self::REPORT_CACHE_SECONDS,
        );

        return response()->json([
            'data' => [
                ...$summary,
                // The rule the counts were produced by, stated alongside so
                // the reader knows what "off site" meant today.
                'threshold_m' => app(FieldVisitVerificationService::class)->thresholdM(),
            ],
        ]);
    }

    private function cached(string $name, array $filters, Closure $build, int $seconds): array
    {
        return Cache::remember(
            'reports:'.$name.':'.md5((string) json_encode($filters)),
            $seconds,
            $build,
        );
    }
}
