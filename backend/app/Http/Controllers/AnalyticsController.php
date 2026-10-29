<?php

namespace App\Http\Controllers;

use App\Http\Requests\BarangayAnalyticsRequest;
use App\Services\AuditLogger;
use App\Services\BarangayDispersalAnalyticsService;
use App\Services\ReportExcelService;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Barangay dispersal and re-dispersal analytics — the HTTP surface of the
 * Reports "Barangay dispersal" tab. Read-only and entirely derived: like the
 * city report, there is no store/update/destroy, because the only way to
 * change an answer is to change the records.
 *
 * Access is the view_analytics capability (route middleware + the
 * FormRequest). Row scoping — a technician's numbers limited to their
 * assigned households — is applied inside
 * BarangayDispersalAnalyticsService's queries, not here, so every consumer
 * of the service gets the same boundary.
 */
class AnalyticsController extends Controller
{
    public function __construct(
        private readonly BarangayDispersalAnalyticsService $analytics,
        private readonly ReportExcelService $excel,
        private readonly AuditLogger $audit,
    ) {}

    /** One row per barangay (zeros included) + the per-metric highest/lowest summary. */
    public function barangayDispersal(BarangayAnalyticsRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->analytics->barangaySummary($request->user(), $request->filters()),
        ]);
    }

    /** Barangay → barangay flows (and, on request, CVO → barangay). */
    public function barangayFlows(BarangayAnalyticsRequest $request): JsonResponse
    {
        $filters = $request->filters();

        return response()->json([
            'data' => $this->analytics->flows($request->user(), $filters, $filters['include_cvo']),
        ]);
    }

    /**
     * The same answer as a spreadsheet — the barangay table and the flow
     * matrix behind the active filters, with the filter summary in the file.
     */
    public function exportBarangayDispersal(BarangayAnalyticsRequest $request): StreamedResponse
    {
        $filters = $request->filters();

        // Data OUT: one row per export, with the filters it used.
        $this->audit->log($request->user(), 'exported', null, [
            'resource' => 'barangay_dispersal_analytics',
            'filters' => array_filter([
                'from' => $filters['from']?->toDateString(),
                'to' => $filters['to']?->toDateString(),
                'animal_type_id' => $filters['animal_type_id'],
                'classification_id' => $filters['classification_id'],
                'event_types' => $filters['event_types'],
                'per_1000' => $filters['per_1000'] ? '1' : null,
                'include_cvo' => $filters['include_cvo'] ? '1' : null,
            ], static fn (mixed $value): bool => $value !== null && $value !== []),
        ]);

        return $this->excel->barangayDispersalDownloadResponse($request->user(), $filters);
    }
}
