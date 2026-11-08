<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\AnimalOwnershipEvent;
use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;

/**
 * The Admin Dashboard Overview — ONE aggregate payload that lets the
 * administrator read the whole program without opening each module.
 *
 * COMPOSITION, NOT REINVENTION: the sections ride the same services the
 * module screens read — ReportService::cityWide for the program/activity
 * totals, ReportChartService for the time series, and
 * FieldVisitVerificationService for the visit verdicts — so the dashboard's
 * numbers can never disagree with the pages it links to. Only the aggregates
 * no existing helper provides (technician roster, registration trend,
 * monitoring split, recent activity) are computed here, each as a single
 * grouped or correlated query; no raw rows are shipped for the client to
 * count.
 *
 * The whole answer is cached briefly (keyed WITHOUT the viewer: every staff
 * role reads the city-wide record, so the payload is viewer-independent —
 * same convention as the analytics cache, minus the role dimension).
 */
class DashboardService
{
    /** How long the whole overview is reused (module pages poll faster). */
    private const CACHE_SECONDS = 60;

    /** Trailing window of every month series on the dashboard. */
    private const TREND_MONTHS = 12;

    private const RECENT_VISITS = 6;
    private const RECENT_ACTIVITY = 8;
    private const ROSTER_LIMIT = 12;

    public function __construct(
        private readonly ReportService $reports,
        private readonly ReportChartService $charts,
        private readonly FieldVisitVerificationService $verification,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function overview(User $viewer): array
    {
        return Cache::remember(
            'dashboard:admin:v1',
            self::CACHE_SECONDS,
            fn (): array => $this->build($viewer),
        );
    }

    private function build(User $viewer): array
    {
        // The Reports screen's own aggregate — program, activity and clinical
        // totals plus the per-barangay table, all in one call it already made
        // cheap with its own cache.
        $report = $this->reports->cityWide($viewer);

        $verification = $this->verification->summaryCounts();

        return [
            'generated_at' => now()->toIso8601String(),

            'kpis' => $this->kpiSection($report, $verification),

            'monitoring' => $this->monitoringSection(),

            'beneficiaries' => [
                ...$report['program'],
                'geo_tagged' => $this->geoTaggedCount(),
                'registrations_by_month' => $this->monthSeries(
                    Beneficiary::query()
                        ->whereNull('deleted_at')
                        ->toBase(),
                    'created_at',
                    null,
                    true,
                ),
            ],

            'field_visits' => $this->fieldVisitSection($verification),

            'technicians' => $this->technicianSection(),

            'dispersal' => [
                'by_event_type' => $this->dispersalCountsByType(),
                'trend' => $this->ownershipTrend(),
            ],

            'distribution' => $this->charts->animalTypeDistribution(),

            // Passed through verbatim from the report aggregate so the
            // dashboard's per-barangay table IS the Reports screen's table.
            'per_barangay' => $report['per_barangay'],

            'audit' => $this->auditSection(),
        ];
    }

    /**
     * The six numbers the administrator should see first. Every KPI carries
     * the module path it belongs to so the card can deep-link.
     *
     * @param  array<string, mixed>  $report
     * @param  array{counts: array<string, int>, review_count: int, total: int}  $verification
     * @return array<string, mixed>
     */
    private function kpiSection(array $report, array $verification): array
    {
        return [
            'beneficiaries' => [
                'total' => (int) $report['program']['households'],
                'geo_tagged' => $this->geoTaggedCount(),
            ],
            'technicians_active' => User::query()
                ->where('role', 'technician')
                ->whereNull('deleted_at')
                ->count(),
            'field_visits_total' => (int) $report['activity']['field_visits'],
            'field_visits_last_30_days' => FieldVisit::query()
                ->whereNull('deleted_at')
                ->where('visited_on', '>=', now()->subDays(30)->toDateString())
                ->count(),
            'monitoring_records' => (int) $report['activity']['monitoring_visits'],
            'dispersal_records' => AnimalOwnershipEvent::query()
                ->where('status', AnimalOwnershipEvent::STATUS_ACTIVE)
                ->count(),
            'visits_needing_review' => $verification['review_count'],
        ];
    }

    /**
     * Monitoring load: how many visit records exist, how many distinct
     * households they cover, and how the program splits across livestock and
     * poultry. The category comes from the animal-types master list
     * (`main_category`); households enrolled before that table existed carry
     * only the legacy `animal_type` string and read as "unspecified" rather
     * than being silently misfiled.
     *
     * @return array<string, mixed>
     */
    private function monitoringSection(): array
    {
        $base = MonitoringRecord::query()
            ->join('beneficiaries', 'beneficiaries.id', '=', 'monitoring_records.beneficiary_id')
            ->leftJoin('animal_types', 'animal_types.id', '=', 'beneficiaries.animal_type_id')
            ->whereNull('beneficiaries.deleted_at')
            ->whereNull('monitoring_records.deleted_at');

        $categoryRows = (clone $base)
            ->selectRaw("case
                when animal_types.main_category in ('livestock', 'poultry') then animal_types.main_category
                when animal_types.main_category is not null then 'other'
                else 'unspecified'
            end as category")
            ->selectRaw('count(*) as records')
            ->selectRaw('count(distinct beneficiaries.id) as households')
            ->groupBy('category')
            ->get()
            ->mapWithKeys(fn (object $row): array => [$row->category => [
                'records' => (int) $row->records,
                'households' => (int) $row->households,
            ]]);

        $categories = [];
        foreach (['livestock', 'poultry', 'other', 'unspecified'] as $category) {
            $categories[$category] = $categoryRows->get($category, ['records' => 0, 'households' => 0]);
        }

        return [
            'total_records' => (clone $base)->count(),
            'monitored_households' => (clone $base)->distinct('beneficiaries.id')->count('beneficiaries.id'),
            'by_category' => $categories,
            'records_by_month' => $this->monthSeries(
                (clone $base)->whereNotNull('monitoring_records.date_monitored'),
                'monitoring_records.date_monitored',
                'monitoring_records.beneficiary_id',
                false,
            ),
        ];
    }

    /** Households with a registered GPS pin. */
    private function geoTaggedCount(): int
    {
        return Beneficiary::query()
            ->whereNull('deleted_at')
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->count();
    }

    /**
     * Field-visit activity: the verdict split (the SAME numbers the Reports
     * screen shows), the monthly rhythm, and the most recent trips for the
     * "latest technician activity" strip.
     *
     * @param  array{counts: array<string, int>, review_count: int, total: int}  $verification
     * @return array<string, mixed>
     */
    private function fieldVisitSection(array $verification): array
    {
        $recent = FieldVisit::query()
            ->with(['beneficiary:id,name_of_farmer,address', 'technician:id,name', 'photos'])
            ->whereNull('deleted_at')
            ->orderByDesc('visited_on')
            ->orderByDesc('id')
            ->limit(self::RECENT_VISITS)
            ->get()
            ->map(fn (FieldVisit $visit): array => [
                'id' => $visit->id,
                'visited_on' => $visit->visited_on?->toDateString(),
                'beneficiary_name' => $visit->beneficiary?->name_of_farmer,
                'beneficiary_address' => $visit->beneficiary?->address,
                'technician_name' => $visit->technician?->name,
                'purpose' => $visit->purpose,
                'verification_status' => $visit->verification_status,
                'has_photo' => $visit->photos->isNotEmpty(),
            ])
            ->all();

        return [
            'verification' => $verification,
            'total' => array_sum($verification['counts']),
            'by_month' => $this->monthSeries(
                FieldVisit::query()
                    ->whereNull('deleted_at')
                    ->whereNotNull('visited_on')
                    ->toBase(),
                'visited_on',
            ),
            'recent' => $recent,
        ];
    }

    /**
     * The field team at a glance: who is on the roster, what each technician
     * is responsible for, what they have actually logged, and when they were
     * last seen. Correlated subqueries keep it one query; the roster is capped
     * (the full workload chart lives in Reports) but the totals are not.
     *
     * @return array<string, mixed>
     */
    private function technicianSection(): array
    {
        $since = now()->subDays(30)->toDateString();

        $roster = User::query()
            ->from('users')
            ->where('users.role', 'technician')
            ->whereNull('users.deleted_at')
            ->selectRaw('users.id, users.name, users.email, users.last_login_at')
            ->selectRaw('(select count(*) from beneficiaries b
                where b.technician_id = users.id and b.deleted_at is null) as assigned_households')
            ->selectRaw('(select count(*) from field_visits fv
                where fv.technician_id = users.id and fv.deleted_at is null) as visits_total')
            ->selectRaw("(select count(*) from field_visits fv30
                where fv30.technician_id = users.id and fv30.deleted_at is null
                and fv30.visited_on >= ?) as visits_last_30_days", [$since])
            ->selectRaw('(select max(fvmax.visited_on) from field_visits fvmax
                where fvmax.technician_id = users.id and fvmax.deleted_at is null) as last_visit_on')
            ->orderBy('users.name')
            ->limit(self::ROSTER_LIMIT)
            ->get()
            ->map(fn (User $technician): array => [
                'id' => $technician->id,
                'name' => $technician->name,
                'assigned_households' => (int) $technician->assigned_households,
                'visits_total' => (int) $technician->visits_total,
                'visits_last_30_days' => (int) $technician->visits_last_30_days,
                // MAX(visited_on) rides back raw from the database (a
                // datetime on some engines) — normalise to the same Y-m-d
                // shape every other date in this payload uses.
                'last_visit_on' => $technician->last_visit_on !== null
                    ? substr((string) $technician->last_visit_on, 0, 10)
                    : null,
                'last_login_at' => $technician->last_login_at?->toIso8601String(),
            ])
            ->all();

        return [
            'active' => User::query()->where('role', 'technician')->whereNull('deleted_at')->count(),
            'deactivated' => User::onlyTrashed()->where('role', 'technician')->count(),
            'roster' => $roster,
        ];
    }

    /**
     * Dispersal movements by type, over the OWNERSHIP-CHAIN events (the same
     * source the map and the barangay analytics read), so the KPI, the map
     * and the analytics tab can never disagree.
     *
     * @return array<string, mixed>
     */
    private function dispersalCountsByType(): array
    {
        $rows = AnimalOwnershipEvent::query()
            ->where('status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->selectRaw('event_type, count(*) as total')
            ->groupBy('event_type')
            ->pluck('total', 'event_type');

        $counts = [];
        foreach (AnimalOwnershipEvent::TYPES as $type) {
            $counts[$type] = (int) ($rows[$type] ?? 0);
        }

        return $counts;
    }

    /**
     * The trailing 12-month dispersal rhythm, read from the SAME
     * ownership-chain events the KPI counts (NOT the legacy dispersal_events
     * table the Reports chart uses — the two diverge once animals are
     * dispersed through the ownership chain, and a dashboard whose trend says
     * "nothing" under a KPI of 124 would be a lie by omission). Households
     * handing an animal on counts as a re-dispersal, matching the analytics'
     * re-dispersal types; a return to the CVO is neither.
     *
     * @return list<array{month: string, label: string, dispersals: int, re_dispersals: int}>
     */
    private function ownershipTrend(): array
    {
        $start = Carbon::now()->startOfMonth()->subMonths(self::TREND_MONTHS - 1)->toDateString();
        $end = Carbon::now()->endOfMonth()->toDateString();

        $rows = AnimalOwnershipEvent::query()
            ->where('status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->whereBetween('event_date', [$start, $end])
            ->selectRaw('substr(event_date, 1, 7) as month')
            ->selectRaw('sum(case when event_type = ? then 1 else 0 end) as dispersals', [AnimalOwnershipEvent::TYPE_DISPERSAL])
            ->selectRaw('sum(case when event_type in (?, ?) then 1 else 0 end) as re_dispersals', [
                AnimalOwnershipEvent::TYPE_RE_DISPERSAL,
                AnimalOwnershipEvent::TYPE_PASS_ON,
            ])
            ->groupBy('month')
            ->get()
            ->mapWithKeys(fn (object $row): array => [$row->month => $row]);

        $months = [];

        for ($cursor = Carbon::now()->startOfMonth()->subMonths(self::TREND_MONTHS - 1); $cursor->lessThanOrEqualTo(Carbon::now()->endOfMonth()); $cursor->addMonth()) {
            $key = $cursor->format('Y-m');
            $row = $rows->get($key);

            $months[] = [
                'month' => $key,
                'label' => $cursor->format('M Y'),
                'dispersals' => (int) ($row->dispersals ?? 0),
                're_dispersals' => (int) ($row->re_dispersals ?? 0),
            ];
        }

        return $months;
    }

    /**
     * The newest audit rows — administrative actions, technician activity and
     * security events in one strip. Shaped for display only; the filterable,
     * paginated trail stays on the Audit screen.
     *
     * @return list<array<string, mixed>>
     */
    private function auditSection(): array
    {
        return ActivityLog::query()
            ->with('actor:id,name,role')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(self::RECENT_ACTIVITY)
            ->get()
            ->map(fn (ActivityLog $log): array => [
                'id' => $log->id,
                'action' => $log->action,
                'actor_name' => $log->actor?->name,
                'actor_role' => $log->actor?->role ?? $log->actor_role,
                'target_type' => $log->target_type,
                'target_id' => $log->target_id,
                'created_at' => $log->created_at?->toIso8601String(),
            ])
            ->all();
    }

    /**
     * A trailing N-month series over any date/datetime column, zero-filled —
     * the same bucketing convention as ReportChartService (`substr(col, 1, 7)`
     * reads identically on MySQL and SQLite; the fill happens over the
     * BUCKETS so a quiet month still draws).
     *
     * The window bounds match the column's storage shape — 'Y-m-d' for a DATE
     * column, 'Y-m-d H:i:s' for a DATETIME — because the test suite runs on
     * SQLite, where the two formats only compare correctly as strings when
     * shaped the same way.
     *
     * @param  \Illuminate\Database\Query\Builder|\Illuminate\Database\Eloquent\Builder  $query  the pre-filtered base query
     * @param  string  $column  fully-qualified date/datetime column
     * @param  string|null  $countDistinct  optional column to count DISTINCT instead of rows
     * @param  bool  $datetimeColumn  true when $column holds a DATETIME
     * @return list<array{month: string, label: string, total: int}>
     */
    private function monthSeries($query, string $column, ?string $countDistinct = null, bool $datetimeColumn = false): array
    {
        $start = Carbon::now()->startOfMonth()->subMonths(self::TREND_MONTHS - 1);
        $end = Carbon::now()->endOfMonth();

        $aggregate = $countDistinct !== null
            ? "count(distinct {$countDistinct})"
            : 'count(*)';

        $rows = $query
            ->whereBetween($column, [
                $datetimeColumn ? $start->copy()->startOfDay()->toDateTimeString() : $start->toDateString(),
                $datetimeColumn ? $end->copy()->endOfDay()->toDateTimeString() : $end->toDateString(),
            ])
            ->selectRaw("substr({$column}, 1, 7) as month")
            ->selectRaw("{$aggregate} as total")
            ->groupBy('month')
            ->pluck('total', 'month');

        $months = [];

        for ($cursor = $start->copy(); $cursor->lessThanOrEqualTo($end); $cursor->addMonth()) {
            $key = $cursor->format('Y-m');

            $months[] = [
                'month' => $key,
                'label' => $cursor->format('M Y'),
                'total' => (int) ($rows[$key] ?? 0),
            ];
        }

        return $months;
    }
}
