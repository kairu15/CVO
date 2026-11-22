<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\HealthRecord;
use App\Models\User;
use App\Support\Barangays;
use App\Support\Pagination;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Animal Health Monitoring — a per-animal rollup over records that already
 * exist. There is no `animal_health` table on purpose: visits, examinations,
 * case observations, vaccinations and field trips are owned by their modules
 * and this service only combines them for the monitoring workspace.
 *
 * The attention rule is deliberately conservative. It never invents a
 * diagnosis: it flags overdue follow-ups, unresolved clinical records,
 * overdue/missing vaccination, and unresolved case observations. The latest
 * confirmed diagnosis is always shown separately from those observations.
 */
class AnimalHealthService
{
    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
        private readonly SettingsService $settings,
    ) {}

    /**
     * Role-scoped, filtered monitoring rows. Every filter and sort runs in SQL
     * before pagination, so a page never hides a more urgent animal on page 2.
     *
     * @param  array<string, mixed>  $filters
     */
    public function listFor(
        User $user,
        array $filters = [],
        int $perPage = Pagination::DEFAULT_PER_PAGE,
    ): LengthAwarePaginator {
        $query = $this->baseQuery($user);
        $this->applyFilters($query, $filters);
        $this->applySort($query, $filters);

        return $query->paginate($perPage)->withQueryString();
    }

    /**
     * The four overview figures, plus the attention-worklist counters, in one
     * scoped aggregate. The derived status is computed in SQL once and then
     * counted, so the cards and the filtered rows cannot disagree.
     *
     * @return array<string, int>
     */
    public function summaryFor(User $user): array
    {
        $expressions = $this->expressions();
        $query = $this->baseQuery($user)
            ->selectRaw("({$expressions['health_status']}) as current_health_status");

        $row = DB::query()
            ->fromSub($query->toBase(), 'health_rows')
            ->selectRaw(
                'count(*) as total_animals,'
                ." coalesce(sum(case when current_health_status = 'healthy' then 1 else 0 end), 0) as healthy_animals,"
                ." coalesce(sum(case when current_health_status = 'observation' then 1 else 0 end), 0) as observation_animals,"
                ." coalesce(sum(case when current_health_status = 'attention' then 1 else 0 end), 0) as attention_animals,"
                ." coalesce(sum(case when current_health_status = 'unrecorded' then 1 else 0 end), 0) as unrecorded_animals,"
                .' coalesce(sum(quantity), 0) as total_quantity,'
                .' coalesce(sum(open_concerns), 0) as open_concerns,'
                .' coalesce(sum(overdue_clinical_follow_ups + overdue_case_follow_ups), 0) as overdue_follow_ups',
            )
            ->first();

        return [
            'total_animals' => (int) ($row->total_animals ?? 0),
            'healthy_animals' => (int) ($row->healthy_animals ?? 0),
            'observation_animals' => (int) ($row->observation_animals ?? 0),
            'attention_animals' => (int) ($row->attention_animals ?? 0),
            'unrecorded_animals' => (int) ($row->unrecorded_animals ?? 0),
            'total_quantity' => (int) ($row->total_quantity ?? 0),
            'open_concerns' => (int) ($row->open_concerns ?? 0),
            'overdue_follow_ups' => (int) ($row->overdue_follow_ups ?? 0),
        ];
    }

    /**
     * Per-barangay counts plus geotagged household locations for the map.
     * Every number is drawn from the same scoped rows as the table.
     *
     * @return array{barangays: list<array<string, mixed>>, locations: list<array<string, mixed>>}
     */
    public function mapFor(User $user): array
    {
        $rows = $this->baseQuery($user)->get();
        $barangays = [];
        $locations = [];

        foreach ($rows as $row) {
            $name = $row->barangay?->name ?? $row->address;
            if (! isset($barangays[$name])) {
                $barangays[$name] = [
                    'name' => $name,
                    'latitude' => $row->barangay?->latitude,
                    'longitude' => $row->barangay?->longitude,
                    'households' => 0,
                    'animals' => 0,
                    'quantity' => 0,
                    'attention' => 0,
                    'observation' => 0,
                    'healthy' => 0,
                ];
            }

            $quantity = max(1, (int) ($row->quantity ?? 1));
            $barangays[$name]['households'] += 1;
            $barangays[$name]['animals'] += 1;
            $barangays[$name]['quantity'] += $quantity;
            $status = $row->current_health_status;
            if (array_key_exists($status, $barangays[$name])) {
                $barangays[$name][$status] += 1;
            }

            if ($row->latitude !== null && $row->longitude !== null) {
                $locations[] = [
                    'id' => $row->id,
                    'beneficiary_id' => $row->id,
                    'name_of_farmer' => $row->name_of_farmer,
                    'animal_type' => $row->animal_type,
                    'barangay' => $name,
                    'quantity' => $quantity,
                    'health_status' => $status,
                    'needs_attention' => $status === 'attention',
                    'latitude' => (float) $row->latitude,
                    'longitude' => (float) $row->longitude,
                ];
            }
        }

        ksort($barangays);

        return [
            'barangays' => array_values($barangays),
            'locations' => $locations,
        ];
    }

    /**
     * Historical examination counts and distinct animals examined per month.
     * Counts are never conflated: one animal can have several examinations.
     *
     * @return array{from: string, to: string, points: list<array{period: string, label: string, examinations: int, animals: int}>}
     */
    public function trendsFor(User $user, ?string $from = null, ?string $to = null): array
    {
        $start = CarbonImmutable::parse($from ?: now()->subMonths(5)->startOfMonth())->startOfMonth();
        $end = CarbonImmutable::parse($to ?: now())->startOfMonth();

        if ($start->greaterThan($end)) {
            [$start, $end] = [$end, $start];
        }

        $records = HealthRecord::query()
            ->whereIn('beneficiary_id', $this->beneficiaries->scopeQueryFor($user)->select('id'))
            ->whereBetween('date_recorded', [
                $start->toDateString(),
                $end->endOfMonth()->toDateString(),
            ])
            ->get(['beneficiary_id', 'date_recorded']);

        $byPeriod = [];
        foreach ($records as $record) {
            $period = $record->date_recorded?->format('Y-m');
            if (! $period) {
                continue;
            }

            $byPeriod[$period] ??= ['examinations' => 0, 'animals' => []];
            $byPeriod[$period]['examinations'] += 1;
            $byPeriod[$period]['animals'][$record->beneficiary_id] = true;
        }

        $points = [];
        for ($month = $start; $month->lessThanOrEqualTo($end); $month = $month->addMonth()) {
            $period = $month->format('Y-m');
            $points[] = [
                'period' => $period,
                'label' => $month->format('M Y'),
                'examinations' => $byPeriod[$period]['examinations'] ?? 0,
                'animals' => count($byPeriod[$period]['animals'] ?? []),
            ];
        }

        return [
            'from' => $start->toDateString(),
            'to' => $end->endOfMonth()->toDateString(),
            'points' => $points,
        ];
    }

    /**
     * One authorized household with the records the detail drawer reads.
     * Existing resources are reused where they own the payload (clinical
     * records and vaccination history); case observations are summarized
     * separately so they can never be mistaken for confirmed diagnoses.
     */
    public function detailFor(User $user, int $beneficiaryId): ?Beneficiary
    {
        $row = $this->baseQuery($user)
            ->where('beneficiaries.id', $beneficiaryId)
            ->first();

        if (! $row) {
            return null;
        }

        return $row->load([
            'purok',
            'healthRecords' => fn ($query) => $query
                ->with('doctor')
                ->orderByDesc('date_recorded')
                ->orderByDesc('id')
                ->limit(12),
            'caseNotes' => fn ($query) => $query
                ->with(['doctor', 'updates.doctor'])
                ->orderByDesc('date_noted')
                ->orderByDesc('id')
                ->limit(10),
            'vaccinations' => fn ($query) => $query
                ->with('technician')
                ->orderByDesc('administered_on')
                ->orderByDesc('id')
                ->limit(12),
            'monitoringRecords' => fn ($query) => $query
                ->with('technician')
                ->orderByDesc('date_monitored')
                ->orderByDesc('id')
                ->limit(12),
            'fieldVisits' => fn ($query) => $query
                ->with('technician')
                ->orderByDesc('visited_on')
                ->orderByDesc('id')
                ->limit(12),
        ]);
    }

    /**
     * Why an animal is flagged, in triage order. Kept public so the resource
     * and table always show the same wording for the same underlying facts.
     *
     * @param  array{status: string}  $schedule
     * @return list<string>
     */
    public static function attentionReasons(
        array $schedule,
        int $openCases,
        int $overdueClinicalFollowUps = 0,
        int $overdueCaseFollowUps = 0,
    ): array {
        $reasons = [];

        if ($schedule['status'] === VaccinationScheduleService::STATUS_OVERDUE) {
            $reasons[] = 'Vaccination overdue';
        }

        if ($schedule['status'] === VaccinationScheduleService::STATUS_NEVER) {
            $reasons[] = 'Never vaccinated';
        }

        if ($openCases > 0) {
            $reasons[] = $openCases === 1 ? '1 open case' : "{$openCases} open cases";
        }

        $overdue = $overdueClinicalFollowUps + $overdueCaseFollowUps;
        if ($overdue > 0) {
            $reasons[] = $overdue === 1 ? '1 overdue follow-up' : "{$overdue} overdue follow-ups";
        }

        return $reasons;
    }

    /**
     * The role-scoped base row: identity plus one correlated aggregate per
     * column. Subqueries keep a page of animals to a single database round
     * trip instead of N+1 queries.
     */
    protected function baseQuery(User $user): Builder
    {
        $expressions = $this->expressions();

        return $this->beneficiaries->scopeQueryFor($user)
            ->with(['technician', 'barangay'])
            ->select('beneficiaries.*')
            ->selectRaw("{$expressions['last_vaccination']} as last_vaccination_date")
            ->selectRaw("{$expressions['last_examination']} as last_examination_date")
            ->selectRaw("{$expressions['last_monitoring']} as last_monitoring_date")
            ->selectRaw("{$expressions['last_field_visit']} as last_field_visit_date")
            ->selectRaw("{$expressions['latest_health_id']} as latest_health_id")
            ->selectRaw("{$expressions['latest_health_date']} as latest_health_date")
            ->selectRaw("{$expressions['latest_diagnosis']} as latest_diagnosis")
            ->selectRaw("{$expressions['latest_outcome']} as latest_outcome")
            ->selectRaw("{$expressions['latest_health_follow_up']} as latest_health_follow_up_on")
            ->selectRaw("{$expressions['latest_health_completed']} as latest_health_follow_up_completed_at")
            ->selectRaw("{$expressions['quantity']} as quantity")
            ->selectRaw("{$expressions['open_concerns']} as open_concerns")
            ->selectRaw("{$expressions['latest_case_status']} as latest_case_status")
            ->selectRaw("{$expressions['latest_case_reference']} as latest_case_reference")
            ->selectRaw("{$expressions['latest_case_date']} as latest_case_date")
            ->selectRaw("{$expressions['latest_case_follow_up']} as latest_case_follow_up_on")
            ->selectRaw("{$expressions['overdue_clinical']} as overdue_clinical_follow_ups")
            ->selectRaw("{$expressions['overdue_case']} as overdue_case_follow_ups")
            ->selectRaw("({$expressions['attention']}) as needs_attention")
            ->selectRaw("({$expressions['health_status']}) as current_health_status")
            ->selectRaw('(select count(*) from case_notes cn where cn.beneficiary_id = beneficiaries.id and cn.deleted_at is null) as notes_count')
            ->selectRaw('(select date(max(cn.date_noted)) from case_notes cn where cn.beneficiary_id = beneficiaries.id and cn.deleted_at is null) as last_note_date');
    }

    /**
     * SQL expressions shared by the list, summary, detail and map, so every
     * view derives the same status from the same facts.
     *
     * @return array<string, string>
     */
    protected function expressions(): array
    {
        $lastVaccination = VaccinationScheduleService::lastVaccinationSql();
        $openOutcomes = $this->quotedList($this->settings->openHealthOutcomes());
        $openCondition = $openOutcomes === ''
            ? 'hr.outcome is null'
            : "(hr.outcome is null or hr.outcome in ({$openOutcomes}))";

        $today = $this->quote(today()->toDateString());
        $overdueOn = $this->quote(
            CarbonImmutable::now()->startOfDay()
                ->subDays($this->settings->vaccinationIntervalDays())
                ->toDateString(),
        );

        $latestHealth = 'from health_records hr where hr.beneficiary_id = beneficiaries.id'
            .' and hr.deleted_at is null order by hr.date_recorded desc, hr.id desc limit 1';
        $latestCase = 'from case_notes cn where cn.beneficiary_id = beneficiaries.id'
            .' and cn.deleted_at is null order by cn.date_noted desc, cn.id desc limit 1';

        $latestOutcome = "(select hr.outcome {$latestHealth})";
        $openConcerns = '(select count(*) from health_records hr where hr.beneficiary_id = beneficiaries.id'
            ." and hr.deleted_at is null and {$openCondition})";
        $overdueClinical = '(select count(*) from health_records hr where hr.beneficiary_id = beneficiaries.id'
            .' and hr.deleted_at is null and hr.follow_up_on is not null'
            ." and hr.follow_up_completed_at is null and hr.follow_up_on < {$today})";
        $overdueCase = '(select count(*) from case_notes cn where cn.beneficiary_id = beneficiaries.id'
            .' and cn.deleted_at is null and cn.follow_up_on is not null'
            ." and cn.follow_up_completed_at is null and cn.status <> 'resolved'"
            ." and cn.follow_up_on < {$today})";

        $attention = "({$lastVaccination} is null"
            ." or {$lastVaccination} < {$overdueOn}"
            ." or {$openConcerns} > 0"
            ." or {$overdueClinical} > 0"
            ." or {$overdueCase} > 0)";

        return [
            'last_vaccination' => $lastVaccination,
            'last_examination' => '(select date(max(hr.date_recorded)) from health_records hr'
                .' where hr.beneficiary_id = beneficiaries.id and hr.deleted_at is null)',
            'last_monitoring' => '(select date(max(mr.date_monitored)) from monitoring_records mr'
                .' where mr.beneficiary_id = beneficiaries.id and mr.deleted_at is null)',
            'last_field_visit' => '(select date(max(fv.visited_on)) from field_visits fv'
                .' where fv.beneficiary_id = beneficiaries.id and fv.deleted_at is null)',
            'latest_health_id' => "(select hr.id {$latestHealth})",
            'latest_health_date' => "(select date(hr.date_recorded) {$latestHealth})",
            'latest_diagnosis' => "(select hr.diagnosis {$latestHealth})",
            'latest_outcome' => $latestOutcome,
            'latest_health_follow_up' => "(select date(hr.follow_up_on) {$latestHealth})",
            'latest_health_completed' => "(select hr.follow_up_completed_at {$latestHealth})",
            'quantity' => "(select coalesce(hr.animal_quantity, 1) {$latestHealth})",
            'open_concerns' => $openConcerns,
            'latest_case_status' => "(select cn.status {$latestCase})",
            'latest_case_reference' => "(select cn.reference_number {$latestCase})",
            'latest_case_date' => "(select date(cn.date_noted) {$latestCase})",
            'latest_case_follow_up' => "(select date(cn.follow_up_on) {$latestCase})",
            'overdue_clinical' => $overdueClinical,
            'overdue_case' => $overdueCase,
            'attention' => $attention,
            'health_status' => "(case when {$attention} then 'attention'"
                ." when (select cn.status {$latestCase}) in ('open', 'observation') then 'observation'"
                ." when {$latestOutcome} = 'recovered' then 'healthy'"
                ." else 'unrecorded' end)",
        ];
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    protected function applyFilters(Builder $query, array $filters): void
    {
        $search = trim((string) ($filters['search'] ?? ''));
        $barangay = trim((string) ($filters['barangay'] ?? ''));
        $status = (string) ($filters['status'] ?? '');
        $attentionOnly = ($filters['filter'] ?? null) === 'attention' || $status === 'attention';
        $from = $filters['from'] ?? null;
        $to = $filters['to'] ?? null;
        $expressions = $this->expressions();

        $query
            ->when($search !== '', function (Builder $query) use ($search): void {
                $pattern = "%{$search}%";

                $query->where(function (Builder $group) use ($pattern): void {
                    $group->whereLike('beneficiaries.name_of_farmer', $pattern)
                        ->orWhereLike('beneficiaries.rsbsa_number', $pattern)
                        ->orWhereLike('beneficiaries.ear_tag_number', $pattern)
                        ->orWhereLike('beneficiaries.animal_type', $pattern)
                        ->orWhereLike('beneficiaries.address', $pattern)
                        ->orWhereExists(function ($health) use ($pattern): void {
                            $health->selectRaw('1')
                                ->from('health_records as search_health')
                                ->whereColumn('search_health.beneficiary_id', 'beneficiaries.id')
                                ->whereNull('search_health.deleted_at')
                                ->where(function ($match) use ($pattern): void {
                                    $match->whereLike('search_health.diagnosis', $pattern)
                                        ->orWhereLike('search_health.symptoms', $pattern);
                                });
                        })
                        ->orWhereExists(function ($case) use ($pattern): void {
                            $case->selectRaw('1')
                                ->from('case_notes as search_case')
                                ->whereColumn('search_case.beneficiary_id', 'beneficiaries.id')
                                ->whereNull('search_case.deleted_at')
                                ->whereLike('search_case.body', $pattern);
                        });
                });
            })
            ->when($barangay !== '', fn (Builder $query) => $query->where(
                'beneficiaries.address',
                Barangays::normalize($barangay),
            ))
            ->when($attentionOnly, fn (Builder $query) => $query->whereRaw($expressions['attention']))
            ->when(
                in_array($status, ['healthy', 'observation', 'unrecorded'], true),
                fn (Builder $query) => $query->whereRaw(
                    "({$expressions['health_status']}) = ?",
                    [$status],
                ),
            )
            ->when($from, fn (Builder $query) => $query->whereRaw(
                "{$expressions['last_examination']} >= ?",
                [$from],
            ))
            ->when($to, fn (Builder $query) => $query->whereRaw(
                "{$expressions['last_examination']} <= ?",
                [$to],
            ));
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    protected function applySort(Builder $query, array $filters): void
    {
        $sort = (string) ($filters['sort'] ?? 'urgency');
        $direction = ($filters['direction'] ?? 'asc') === 'desc' ? 'desc' : 'asc';

        match ($sort) {
            'name' => $query->orderBy('beneficiaries.name_of_farmer', $direction),
            'barangay' => $query
                ->orderBy('beneficiaries.address', $direction)
                ->orderBy('beneficiaries.name_of_farmer'),
            'status' => $query->orderByRaw(
                "case ({$this->expressions()['health_status']})"
                ." when 'attention' then 0 when 'observation' then 1 when 'unrecorded' then 2 else 3 end {$direction}",
            ),
            'examination' => $query
                ->orderByRaw("{$this->expressions()['last_examination']} {$direction}"),
            default => $query
                ->orderByRaw(
                    "case {$this->expressions()['health_status']}"
                    ." when 'attention' then 0 when 'observation' then 1 when 'unrecorded' then 2 else 3 end",
                )
                ->orderByRaw("{$this->expressions()['last_examination']} desc"),
        };

        $query->orderBy('beneficiaries.id');
    }

    /**
     * Quote a value for an internal SQL expression. These values come from
     * settings and today's date, never from the request.
     */
    private function quote(string $value): string
    {
        $quoted = DB::connection()->getPdo()->quote($value);

        return $quoted !== false
            ? $quoted
            : "'".str_replace("'", "''", $value)."'";
    }

    /**
     * @param  list<string>  $values
     */
    private function quotedList(array $values): string
    {
        return implode(',', array_map(fn (string $value): string => $this->quote($value), $values));
    }
}
