<?php

namespace App\Services;

use App\Models\Barangay;
use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use App\Models\UserNotification;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * Smart Alerts — a daily, rule-based scan over records already in the system.
 *
 * No model, no training data, no external service: every rule is a plain SQL
 * aggregation plus a threshold comparison, and each fires in milliseconds even
 * at a few thousand records. The thresholds live in config/cvo.php
 * (`smart_alerts`) so the office can tune them without a code change.
 *
 * Unlike the derived notification feed, these alerts are STORED — they have
 * read state and a stable `dedupe_key` — because the scan re-runs daily and
 * must not accumulate duplicates. The scan also CLEARS an alert whose
 * condition no longer holds: an alert restates a fact, so it must not outlive
 * it. Read state on an alert that still holds is preserved across runs.
 *
 * Recipients are `admin` (always) and the household's assigned `technician`
 * (where the rule is about one household). Barangay-level flags go to admins
 * only — there is no single technician they belong to.
 */
class SmartAlertService
{
    public const RULE_VACCINATION_OVERDUE = 'vaccination-overdue';

    public const RULE_BCS_OUT_OF_RANGE = 'bcs-out-of-range';

    public const RULE_NO_RECENT_VISIT = 'no-recent-visit';

    public const RULE_BARANGAY_FLAG = 'barangay-flag';

    /** The dedicated link smart alerts resolve to, by recipient role. */
    private const ALERT_LINK_ADMIN = '/dashboard/admin/notifications';

    private const ALERT_LINK_TECHNICIAN = '/dashboard/technician/notifications';

    public function __construct(private readonly SettingsService $settings) {}

    /**
     * Admin recipients, resolved once per run rather than once per rule per
     * household — the same handful of accounts receives every alert.
     *
     * @var Collection<int, User>|null
     */
    private ?Collection $admins = null;

    /**
     * Run every enabled rule, reconcile the stored rows, and report how many
     * recipient-rows each rule produced.
     *
     * @return array<string, int> rule => alert rows written
     */
    public function run(): array
    {
        $rules = [
            self::RULE_VACCINATION_OVERDUE => fn (): array => $this->overdueVaccinationAlerts(),
            self::RULE_BCS_OUT_OF_RANGE => fn (): array => $this->bcsOutOfRangeAlerts(),
            self::RULE_NO_RECENT_VISIT => fn (): array => $this->noRecentVisitAlerts(),
            self::RULE_BARANGAY_FLAG => fn (): array => $this->barangayFlagAlerts(),
        ];

        $specs = [];
        $counts = [];

        foreach ($rules as $rule => $compute) {
            $ruleSpecs = $compute();

            $counts[$rule] = count($ruleSpecs);
            $specs = array_merge($specs, $ruleSpecs);
        }

        $this->reconcile($specs);

        return $counts;
    }

    /**
     * Whether the BCS rule is currently enabled. The command surfaces this so
     * an operator sees why a rule produced nothing rather than assuming a
     * silent bug.
     */
    public function bcsRuleEnabled(): bool
    {
        return $this->generalBcsRange() !== null
            || config('cvo.smart_alerts.bcs_normal_ranges', []) !== [];
    }

    /**
     * The general BCS band, or null when none is configured.
     *
     * Kept in one place so `bcsRuleEnabled()` and the rule itself agree on
     * what "configured" means — a mismatch would either skip an enabled rule
     * or run a disabled one.
     *
     * @return array{0: int, 1: int}|null
     */
    private function generalBcsRange(): ?array
    {
        $range = config('cvo.smart_alerts.bcs_normal_range');

        if (! is_array($range) || count($range) !== 2) {
            return null;
        }

        return [(int) $range[0], (int) $range[1]];
    }

    /**
     * Write the current alert set and clear the ones that no longer apply.
     *
     * @param  list<array<string, mixed>>  $specs
     */
    private function reconcile(array $specs): void
    {
        $keys = [];

        foreach ($specs as $spec) {
            $keys[] = $spec['dedupe_key'];

            UserNotification::updateOrCreate(
                ['dedupe_key' => $spec['dedupe_key']],
                [
                    'user_id' => $spec['user_id'],
                    'beneficiary_id' => $spec['beneficiary_id'] ?? null,
                    'monitoring_record_id' => $spec['monitoring_record_id'] ?? null,
                    'type' => $spec['type'],
                    'title' => $spec['title'],
                    'message' => $spec['message'],
                    'link' => $spec['link'] ?? null,
                ],
            );
        }

        $stale = UserNotification::query()->whereIn('type', UserNotification::SMART_TYPES);

        if ($keys === []) {
            $stale->delete();

            return;
        }

        $stale->whereNotIn('dedupe_key', $keys)->delete();
    }

    /**
     * Rule 1 — overdue vaccination.
     *
     * Reuses the Vaccination Schedule's own definition of "overdue" (a
     * vaccination older than `vaccination_interval_days`, currently 180) by
     * sharing its correlated subquery, so the alert and that screen can never
     * disagree about which animals are late.
     *
     * @return list<array<string, mixed>>
     */
    private function overdueVaccinationAlerts(): array
    {
        // The administrator-editable cycle, shared with the Vaccination
        // Schedule through SettingsService so the alert and that screen can
        // never disagree about which animals are late.
        $interval = $this->settings->vaccinationIntervalDays();
        $overdueOn = CarbonImmutable::now()->startOfDay()->subDays($interval)->toDateString();
        $last = VaccinationScheduleService::lastVaccinationSql();

        $animals = Beneficiary::query()
            ->with('technician')
            ->select('beneficiaries.*')
            ->selectRaw("{$last} as last_vaccination_date")
            ->whereRaw("{$last} < ?", [$overdueOn])
            ->get();

        $specs = [];

        foreach ($animals as $animal) {
            foreach ($this->recipientsFor($animal) as $user) {
                $specs[] = [
                    'dedupe_key' => "smart-vaccination-overdue:u{$user->id}:b{$animal->id}",
                    'user_id' => $user->id,
                    'beneficiary_id' => $animal->id,
                    'type' => UserNotification::TYPE_SMART_VACCINATION_OVERDUE,
                    'title' => 'Smart alert: vaccination overdue',
                    'message' => sprintf(
                        '%s was last vaccinated on %s — over %d days ago with no newer vaccination recorded.',
                        $this->animalLabel($animal),
                        $animal->last_vaccination_date,
                        $interval,
                    ),
                    'link' => $this->linkFor($user),
                ];
            }
        }

        return $specs;
    }

    /**
     * Rule 2 — Body Condition Score outside the expected range.
     *
     * The band comes from config/cvo.php: a GENERAL range applied to every
     * animal type (`bcs_normal_range`, confirmed by the CVO as 2–4 on the 1–5
     * scale) with optional per-species overrides (`bcs_normal_ranges`). A
     * species with neither stays unflagged rather than being guessed at;
     * setting both empty disables the rule and `bcsRuleEnabled()` reports it.
     *
     * The comparison is against each household's MOST RECENT recorded BCS, not
     * any historical value — a score that was low months ago and has since
     * recovered is not a current concern.
     *
     * @return list<array<string, mixed>>
     */
    private function bcsOutOfRangeAlerts(): array
    {
        $general = $this->generalBcsRange();
        $perSpecies = config('cvo.smart_alerts.bcs_normal_ranges', []);

        if ($general === null && $perSpecies === []) {
            return [];
        }

        $latestBcs = '(select mr.bcs from monitoring_records mr'
            .' where mr.beneficiary_id = beneficiaries.id and mr.deleted_at is null'
            .' and mr.bcs is not null'
            .' order by mr.date_monitored desc, mr.id desc limit 1)';

        $animals = Beneficiary::query()
            ->with('technician')
            ->select('beneficiaries.*')
            ->selectRaw("{$latestBcs} as latest_bcs")
            ->whereRaw("{$latestBcs} is not null")
            ->get();

        $specs = [];

        foreach ($animals as $animal) {
            // Per-species override first, then the general band.
            $range = $perSpecies[$animal->animal_type] ?? $general;

            // Neither configured for this species → do not guess; skip it.
            if ($range === null) {
                continue;
            }

            [$min, $max] = $range;
            $bcs = (int) $animal->latest_bcs;

            if ($bcs >= $min && $bcs <= $max) {
                continue;
            }

            foreach ($this->recipientsFor($animal) as $user) {
                $specs[] = [
                    'dedupe_key' => "smart-bcs-out-of-range:u{$user->id}:b{$animal->id}",
                    'user_id' => $user->id,
                    'beneficiary_id' => $animal->id,
                    'type' => UserNotification::TYPE_SMART_BCS_OUT_OF_RANGE,
                    'title' => 'Smart alert: BCS outside normal range',
                    'message' => sprintf(
                        '%s scored BCS %d on its latest visit — outside the normal range of %d–%d for %s.',
                        $this->animalLabel($animal),
                        $bcs,
                        $min,
                        $max,
                        $animal->animal_type,
                    ),
                    'link' => $this->linkFor($user),
                ];
            }
        }

        return $specs;
    }

    /**
     * Rule 3 — no recent field visit.
     *
     * A household created at least N days ago whose latest visit is older than
     * N days, or which has none at all. The creation guard keeps newly
     * registered households — which have had no chance to be visited yet — out
     * of the flag.
     *
     * @return list<array<string, mixed>>
     */
    private function noRecentVisitAlerts(): array
    {
        $days = (int) config('cvo.smart_alerts.no_recent_visit_days');
        $cutoff = CarbonImmutable::now()->startOfDay()->subDays($days)->toDateString();
        $lastVisit = '(select max(fv.visited_on) from field_visits fv where fv.beneficiary_id = beneficiaries.id and fv.deleted_at is null)';

        $animals = Beneficiary::query()
            ->with('technician')
            ->select('beneficiaries.*')
            ->selectRaw("{$lastVisit} as last_visit_on")
            ->where('created_at', '<=', CarbonImmutable::now()->subDays($days))
            ->whereRaw("({$lastVisit} is null or {$lastVisit} < ?)", [$cutoff])
            ->get();

        $specs = [];

        foreach ($animals as $animal) {
            foreach ($this->recipientsFor($animal) as $user) {
                $specs[] = [
                    'dedupe_key' => "smart-no-recent-visit:u{$user->id}:b{$animal->id}",
                    'user_id' => $user->id,
                    'beneficiary_id' => $animal->id,
                    'type' => UserNotification::TYPE_SMART_NO_RECENT_VISIT,
                    'title' => 'Smart alert: no recent field visit',
                    'message' => $animal->last_visit_on
                        ? sprintf(
                            '%s was last visited on %s — over %d days ago.',
                            $this->householdLabel($animal),
                            $animal->last_visit_on,
                            $days,
                        )
                        : sprintf(
                            '%s has no recorded field visit and was registered over %d days ago.',
                            $this->householdLabel($animal),
                            $days,
                        ),
                    'link' => $this->linkFor($user),
                ];
            }
        }

        return $specs;
    }

    /**
     * Rule 4 — barangay-level flag rate.
     *
     * For the current month: a barangay whose share of records carrying a
     * "concern" remark is above the city-wide share by more than the
     * configured multiplier, and which has at least the configured minimum
     * number of records (so one bad record in a two-record barangay cannot
     * flag it). Pure ratio arithmetic — no model.
     *
     * @return list<array<string, mixed>>
     */
    private function barangayFlagAlerts(): array
    {
        $keywords = config('cvo.smart_alerts.concern_remarks', []);
        $minRecords = (int) config('cvo.smart_alerts.barangay_flag_min_records');
        $multiplier = (float) config('cvo.smart_alerts.barangay_flag_ratio_multiplier');

        if ($keywords === [] || $multiplier <= 0) {
            return [];
        }

        $start = CarbonImmutable::now()->startOfMonth()->toDateString();
        $end = CarbonImmutable::now()->endOfMonth()->toDateString();

        [$concernSql, $bindings] = $this->concernExpression($keywords);

        // `date()` normalizes `date_monitored` for the comparison: the column
        // is cast to a datetime string, so a bare between-strings test drops a
        // row dated exactly on the last day of the month (the same SQLite/MySQL
        // boundary trap VaccinationScheduleService documents).
        $rows = MonitoringRecord::query()
            ->join('beneficiaries', 'beneficiaries.id', '=', 'monitoring_records.beneficiary_id')
            ->whereNull('beneficiaries.deleted_at')
            ->whereRaw('date(monitoring_records.date_monitored) >= ?', [$start])
            ->whereRaw('date(monitoring_records.date_monitored) <= ?', [$end])
            ->whereNotNull('beneficiaries.barangay_id')
            ->select('beneficiaries.barangay_id')
            ->selectRaw('count(*) as total')
            ->selectRaw("sum(case when {$concernSql} then 1 else 0 end) as concerned", $bindings)
            ->groupBy('beneficiaries.barangay_id')
            ->get();

        $totalRecords = (int) $rows->sum('total');

        if ($totalRecords === 0) {
            return [];
        }

        $cityRate = $rows->sum('concerned') / $totalRecords;

        if ($cityRate <= 0) {
            return [];
        }

        $threshold = $cityRate * $multiplier;
        $admins = $this->adminUsers();
        $names = Barangay::query()->pluck('name', 'id');

        if ($admins->isEmpty()) {
            return [];
        }

        $month = CarbonImmutable::now()->format('Y-m');
        $specs = [];

        foreach ($rows as $row) {
            $total = (int) $row->total;

            if ($total < $minRecords) {
                continue;
            }

            $concerned = (int) $row->concerned;
            $rate = $concerned / $total;

            if ($rate <= $threshold) {
                continue;
            }

            $barangayId = (int) $row->barangay_id;
            $barangay = $names[$barangayId] ?? "Barangay #{$barangayId}";

            foreach ($admins as $admin) {
                $specs[] = [
                    'dedupe_key' => "smart-barangay-flag:u{$admin->id}:bg{$barangayId}:{$month}",
                    'user_id' => $admin->id,
                    'type' => UserNotification::TYPE_SMART_BARANGAY_FLAG,
                    'title' => 'Smart alert: flagged barangay',
                    'message' => sprintf(
                        '%s has %d of %d visit records this month with a concern remark (%.0f%% vs %.0f%% city-wide).',
                        $barangay,
                        $concerned,
                        $total,
                        $rate * 100,
                        $cityRate * 100,
                    ),
                    'link' => self::ALERT_LINK_ADMIN,
                ];
            }
        }

        return $specs;
    }

    /**
     * A case-insensitive OR over the concern keywords against the free-text
     * remarks column, plus its bindings.
     *
     * @param  list<string>  $keywords
     * @return array{0: string, 1: list<string>}
     */
    private function concernExpression(array $keywords): array
    {
        $clauses = [];
        $bindings = [];

        foreach ($keywords as $keyword) {
            $clauses[] = 'lower(coalesce(monitoring_records.remarks, \'\')) like ?';
            $bindings[] = '%'.strtolower($keyword).'%';
        }

        return [implode(' or ', $clauses), $bindings];
    }

    /**
     * The alert recipients for a household: every admin, plus the assigned
     * technician when there is one. Deduplicated so a beneficiary never
     * produces two rows for the same user.
     *
     * @return Collection<int, User>
     */
    private function recipientsFor(Beneficiary $beneficiary): Collection
    {
        $admins = $this->adminUsers();

        if ($beneficiary->technician_id === null) {
            return $admins;
        }

        $technician = $beneficiary->technician;

        if ($technician === null) {
            return $admins;
        }

        return $admins->concat([$technician])->unique('id')->values();
    }

    /**
     * @return Collection<int, User>
     */
    private function adminUsers(): Collection
    {
        return $this->admins ??= User::query()->where('role', 'admin')->get();
    }

    /** "Carabao (F) in Banay Banay" — the animal, not the household. */
    private function animalLabel(Beneficiary $animal): string
    {
        return trim(sprintf(
            '%s%s in %s',
            $animal->animal_type,
            $animal->sex ? " ({$animal->sex})" : '',
            $animal->address,
        ));
    }

    /** "Aling Nena in Banay Banay" — the household that was not visited. */
    private function householdLabel(Beneficiary $beneficiary): string
    {
        return "{$beneficiary->name_of_farmer} in {$beneficiary->address}";
    }

    /** Smart alerts have a dedicated home per role. */
    private function linkFor(User $user): string
    {
        return $user->role === 'technician'
            ? self::ALERT_LINK_TECHNICIAN
            : self::ALERT_LINK_ADMIN;
    }
}
