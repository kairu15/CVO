<?php

namespace App\Http\Controllers;

use App\Http\Requests\ReportChartRequest;
use App\Http\Requests\ReportRequest;
use App\Http\Requests\ReportTemplateExportRequest;
use App\Models\FieldVisit;
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
                ],
                fn (): array => $this->reports->cityWide(
                    $request->user(),
                    $validated['barangay'] ?? null,
                    isset($validated['from']) ? Carbon::parse($validated['from']) : null,
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

        return response()->json(['data' => $this->cached(
            'dispersal-trend',
            [
                'barangay' => $v['barangay'] ?? null,
                'animal_type' => $v['animal_type'] ?? null,
                'from' => $v['from'] ?? null,
                'to' => $v['to'] ?? null,
            ],
            fn (): array => $this->charts->dispersalTrend(
                $v['barangay'] ?? null,
                $v['animal_type'] ?? null,
                $v['from'] ?? null,
                $v['to'] ?? null,
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
                'from' => $v['from'] ?? null,
                'to' => $v['to'] ?? null,
            ],
            fn (): array => $this->charts->animalsByBarangay(
                $v['animal_type'] ?? null,
                $v['from'] ?? null,
                $v['to'] ?? null,
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
            ],
            fn (): array => $this->charts->vaccinationCompliance(
                $v['barangay'] ?? null,
                $v['animal_type'] ?? null,
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
            ],
            fn (): array => $this->charts->animalTypeDistribution(
                $v['month'] ?? null,
                $v['from'] ?? null,
                $v['to'] ?? null,
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
            ['barangay' => $v['barangay'] ?? null],
            fn (): array => $this->charts->technicianWorkload(
                $v['barangay'] ?? null,
            ),
            self::CHART_CACHE_SECONDS,
        )]);
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
     * One grouped COUNT over the stored verdicts — no rows leave the server —
     * plus the threshold the verdicts were judged against, so the number on
     * the screen cannot drift from the rule that produced it. `review_count`
     * is exactly the bucket the "Off-site / needs review" filter serves.
     */
    public function verificationSummary(ReportChartRequest $request): JsonResponse
    {
        $summary = $this->cached('verification-summary', [], function (): array {
            $rows = FieldVisit::query()
                ->selectRaw("coalesce(verification_status, 'unreviewed') as status")
                ->selectRaw('count(*) as total')
                ->groupBy('status')
                ->pluck('total', 'status');

            $counts = array_fill_keys([...FieldVisitVerificationService::STATUSES, 'unreviewed'], 0);

            foreach ($rows as $status => $total) {
                $counts[$status] = (int) $total;
            }

            $review = array_sum(array_intersect_key(
                $counts,
                array_flip([...FieldVisitVerificationService::REVIEW_STATUSES, 'unreviewed']),
            ));

            return [
                'counts' => $counts,
                'review_count' => $review,
                'total' => array_sum($counts),
            ];
        }, self::REPORT_CACHE_SECONDS);

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
