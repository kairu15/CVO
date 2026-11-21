<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\User;
use App\Models\Vaccination;
use App\Models\VaccinationScheduleOverride;
use App\Support\Barangays;
use App\Support\Pagination;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Vaccination schedule and history.
 *
 * The schedule remains a read model: the effective next-due date is the
 * household's explicit override when one exists (recording or rescheduling),
 * otherwise the latest recorded vaccination — new `vaccinations` rows or the
 * legacy `monitoring_records.vaccination_date` — plus the applicable protocol
 * interval. No status column is stored, so "overdue" cannot go stale.
 */
class VaccinationScheduleService
{
    public const STATUS_NEVER = 'never';

    public const STATUS_OVERDUE = 'overdue';

    public const STATUS_DUE_SOON = 'due-soon';

    public const STATUS_SCHEDULED = 'scheduled';

    /** @var list<string> */
    public const STATUSES = [
        self::STATUS_NEVER,
        self::STATUS_OVERDUE,
        self::STATUS_DUE_SOON,
        self::STATUS_SCHEDULED,
    ];

    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
        private readonly SettingsService $settings,
        private readonly AuditLogger $audit,
    ) {}

    public function intervalDays(): int
    {
        return $this->settings->vaccinationIntervalDays();
    }

    public function dueSoonDays(): int
    {
        return $this->settings->vaccinationDueSoonDays();
    }

    /**
     * Role-scoped schedule with server-side search, filtering and sorting.
     *
     * @param  array<string, mixed>  $filters
     */
    public function listFor(
        User $user,
        array $filters = [],
        int $perPage = Pagination::DEFAULT_PER_PAGE,
    ): LengthAwarePaginator {
        $query = $this->baseScheduleQuery($user);
        $last = self::lastVaccinationSql();

        $this->applySearch($query, $filters);
        $this->applyStatusFilter($query, $filters['status'] ?? null, $last);
        $this->applySort($query, $filters, $last);

        return $query->paginate($perPage)->withQueryString();
    }

    /**
     * Overview figures. "Completed" means the latest dose is still inside its
     * current cycle (the next dose is scheduled); "upcoming" is the due-soon
     * window; "overdue" is past due.
     *
     * @return array<string, int>
     */
    public function summaryFor(User $user): array
    {
        $last = self::lastVaccinationSql();
        $base = fn (): Builder => $this->baseScheduleQuery($user);

        $count = function (string $status) use ($base, $last): int {
            $query = $base();
            $this->applyStatusFilter($query, $status, $last);

            return $query->count();
        };

        return [
            'total_scheduled' => $base()->count(),
            'upcoming' => $count(self::STATUS_DUE_SOON),
            'completed' => $count(self::STATUS_SCHEDULED),
            'overdue' => $count(self::STATUS_OVERDUE),
            'never' => $count(self::STATUS_NEVER),
            'protocol_days' => $this->intervalDays(),
        ];
    }

    /**
     * One schedule row after a write, so the row response is shaped exactly
     * like the list row.
     */
    public function scheduleRowFor(User $user, int $beneficiaryId): ?Beneficiary
    {
        return $this->baseScheduleQuery($user)
            ->where('beneficiaries.id', $beneficiaryId)
            ->first();
    }

    /**
     * Completed vaccination history for one authorized household.
     */
    public function historyFor(User $user, int $beneficiaryId): array
    {
        $this->beneficiaries->findFor($user, $beneficiaryId);

        return Vaccination::query()
            ->where('beneficiary_id', $beneficiaryId)
            ->with(['beneficiary', 'technician'])
            ->orderByDesc('administered_on')
            ->orderByDesc('id')
            ->get()
            ->all();
    }

    /** Record a completed vaccination for one authorized household. */
    public function recordFor(User $technician, int $beneficiaryId, array $data): Vaccination
    {
        return $this->record(
            $technician,
            $this->beneficiaries->findFor($technician, $beneficiaryId),
            $data,
        );
    }

    /** Reschedule one authorized household's current cycle. */
    public function rescheduleFor(User $actor, int $beneficiaryId, array $data): Beneficiary
    {
        $beneficiary = $this->beneficiaries->findFor($actor, $beneficiaryId);
        $this->reschedule($actor, $beneficiary, $data);

        return $beneficiary;
    }

    /**
     * Record a completed vaccination and set the next-due override.
     */
    public function record(User $technician, Beneficiary $beneficiary, array $data): Vaccination
    {
        $administered = CarbonImmutable::parse($data['administered_on']);
        $nextDue = $data['next_due_on']
            ?? $administered->addDays((int) $data['protocol_days'])->toDateString();

        return DB::transaction(function () use ($technician, $beneficiary, $data, $nextDue): Vaccination {
            $vaccination = Vaccination::create([
                ...$data,
                'beneficiary_id' => $beneficiary->id,
                'technician_id' => $technician->id,
                'next_due_on' => $nextDue,
            ]);

            $this->saveOverride($beneficiary, $nextDue, 'Recorded vaccination', $technician->id);

            return $vaccination;
        });
    }

    /**
     * Move the current cycle's next-due date without touching the historical
     * administration rows.
     */
    public function reschedule(User $actor, Beneficiary $beneficiary, array $data): VaccinationScheduleOverride
    {
        $previous = $beneficiary->vaccinationScheduleOverride?->next_due_on?->toDateString();

        $override = DB::transaction(function () use ($beneficiary, $actor, $data): VaccinationScheduleOverride {
            return $this->saveOverride(
                $beneficiary,
                $data['next_due_on'],
                $data['reason'] ?? null,
                $actor->id,
            );
        });

        $this->audit->log(
            $actor,
            'vaccination_rescheduled',
            $beneficiary,
            ['reason' => $data['reason'] ?? null],
            ['next_due_on' => $previous],
            ['next_due_on' => $override->next_due_on?->toDateString()],
        );

        return $override;
    }

    /**
     * The vocabulary the quick-record form needs. Vaccine names are historical
     * values, not a fabricated catalogue; the technician may enter a new one.
     *
     * @return array{protocol_days: int, vaccine_names: list<string>}
     */
    public function optionsFor(User $user): array
    {
        $beneficiaryIds = $this->beneficiaries->scopeQueryFor($user)->select('id');

        return [
            'protocol_days' => $this->intervalDays(),
            'vaccine_names' => Vaccination::query()
                ->whereIn('beneficiary_id', $beneficiaryIds)
                ->whereNotNull('vaccine_name')
                ->distinct()
                ->orderBy('vaccine_name')
                ->pluck('vaccine_name')
                ->all(),
        ];
    }

    /**
     * Whether a beneficiary's cycle matches the requested status. Kept public
     * because the resource and the SQL filter must use the same thresholds.
     */
    public function matchesStatus(?string $lastVaccination, string $status, ?string $override = null, ?int $protocolDays = null): bool
    {
        return self::scheduleFor($lastVaccination, $override, $protocolDays)['status'] === $status;
    }

    /**
     * Derived schedule fields. The override is authoritative when present;
     * otherwise the latest recorded date plus the protocol interval (the
     * per-record interval when supplied, the program default for legacy rows).
     *
     * @return array{last_vaccination_date: ?string, next_due_date: ?string, days_until_due: ?int, status: string}
     */
    public static function scheduleFor(
        ?string $lastVaccination,
        ?string $nextDueOverride = null,
        ?int $protocolDays = null,
        ?string $latestNextDue = null,
    ): array {
        $settings = app(SettingsService::class);
        $interval = $protocolDays ?: $settings->vaccinationIntervalDays();
        $window = $settings->vaccinationDueSoonDays();

        $last = $lastVaccination ? CarbonImmutable::parse($lastVaccination)->startOfDay() : null;
        $nextDue = $nextDueOverride
            ? CarbonImmutable::parse($nextDueOverride)->startOfDay()
            : ($latestNextDue
                ? CarbonImmutable::parse($latestNextDue)->startOfDay()
                : $last?->addDays($interval));

        if (! $nextDue) {
            return [
                'last_vaccination_date' => null,
                'next_due_date' => null,
                'days_until_due' => null,
                'status' => self::STATUS_NEVER,
            ];
        }

        $today = CarbonImmutable::now()->startOfDay();
        $daysUntilDue = (int) floor(($nextDue->getTimestamp() - $today->getTimestamp()) / 86400);

        $status = match (true) {
            $daysUntilDue < 0 => self::STATUS_OVERDUE,
            $daysUntilDue <= $window => self::STATUS_DUE_SOON,
            default => self::STATUS_SCHEDULED,
        };

        return [
            'last_vaccination_date' => $last?->toDateString(),
            'next_due_date' => $nextDue->toDateString(),
            'days_until_due' => $daysUntilDue,
            'status' => $status,
        ];
    }

    /**
     * The latest recorded vaccination date across the new history table and
     * the legacy monitoring column. Newer records win; ties are equivalent.
     */
    public static function lastVaccinationSql(): string
    {
        $monitoring = '(select date(max(mr.vaccination_date)) from monitoring_records mr'
            .' where mr.beneficiary_id = beneficiaries.id and mr.deleted_at is null'
            .' and mr.vaccination_date is not null)';

        $vaccinations = '(select date(max(vax.administered_on)) from vaccinations vax'
            .' where vax.beneficiary_id = beneficiaries.id and vax.deleted_at is null)';

        return "(case when {$monitoring} is null then {$vaccinations}"
            ." when {$vaccinations} is null then {$monitoring}"
            ." when {$monitoring} >= {$vaccinations} then {$monitoring}"
            ." else {$vaccinations} end)";
    }

    protected function baseScheduleQuery(User $user): Builder
    {
        $last = self::lastVaccinationSql();

        return $this->beneficiaries->scopeQueryFor($user)
            ->with(['technician', 'latestVaccination.technician'])
            ->leftJoin('vaccination_schedule_overrides as vso', 'vso.beneficiary_id', '=', 'beneficiaries.id')
            ->select('beneficiaries.*')
            ->selectRaw("{$last} as last_vaccination_date")
            ->selectRaw(self::latestVaccinationNextDueSql().' as latest_vaccination_next_due_on')
            ->selectRaw('vso.next_due_on as scheduled_next_due_on')
            // Must come after select(), which would otherwise reset the
            // aggregate subquery withCount adds to the select list.
            ->withCount('vaccinations');
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    protected function applySearch(Builder $query, array $filters): void
    {
        $search = trim((string) ($filters['search'] ?? ''));
        $barangay = trim((string) ($filters['barangay'] ?? ''));

        $query
            ->when($search !== '', function (Builder $query) use ($search): void {
                $pattern = "%{$search}%";
                $query->where(function (Builder $group) use ($pattern): void {
                    $group->whereLike('beneficiaries.name_of_farmer', $pattern)
                        ->orWhereLike('beneficiaries.rsbsa_number', $pattern)
                        ->orWhereLike('beneficiaries.ear_tag_number', $pattern)
                        ->orWhereLike('beneficiaries.animal_type', $pattern)
                        ->orWhereLike('beneficiaries.address', $pattern)
                        ->orWhereHas('vaccinations', fn (Builder $v) => $v
                            ->whereLike('vaccine_name', $pattern)
                            ->orWhereLike('batch_number', $pattern));
                });
            })
            ->when($barangay !== '', fn (Builder $query) => $query
                ->where('beneficiaries.address', Barangays::normalize($barangay)));
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    protected function applySort(Builder $query, array $filters, string $last): void
    {
        $sort = (string) ($filters['sort'] ?? 'due');
        $direction = ($filters['direction'] ?? 'asc') === 'desc' ? 'desc' : 'asc';

        $latestDue = self::latestVaccinationNextDueSql();

        match ($sort) {
            'name' => $query->orderBy('beneficiaries.name_of_farmer', $direction),
            'barangay' => $query->orderBy('beneficiaries.address', $direction)
                ->orderBy('beneficiaries.name_of_farmer'),
            'last_vaccination' => $query->orderByRaw("{$last} {$direction}"),
            default => $query
                // Never-vaccinated households lead the worklist; the next
                // dated due date follows, then the name for a stable order.
                ->orderByRaw("(coalesce(vso.next_due_on, {$latestDue}, {$last}) is null) desc")
                ->orderByRaw("coalesce(vso.next_due_on, {$latestDue}, {$last}) {$direction}")
                ->orderBy('beneficiaries.name_of_farmer'),
        };

        $query->orderBy('beneficiaries.id');
    }

    /**
     * Status conditions use the override's date when present; otherwise the
     * legacy interval arithmetic applies. Both branches are grouped so other
     * filters (search, barangay) cannot be bypassed by an OR.
     */
    protected function applyStatusFilter(Builder $query, ?string $status, string $last): void
    {
        if ($status === null) {
            return;
        }

        $today = CarbonImmutable::now()->startOfDay();
        $todayDate = $today->toDateString();
        $windowEnd = $today->addDays($this->dueSoonDays())->toDateString();
        $overdueOn = $today->subDays($this->intervalDays())->toDateString();
        $dueSoonOn = $today->addDays($this->dueSoonDays())
            ->subDays($this->intervalDays())
            ->toDateString();
        $latestDue = self::latestVaccinationNextDueSql();

        match ($status) {
            self::STATUS_NEVER => $query
                ->whereNull('vso.next_due_on')
                ->whereRaw("{$latestDue} is null")
                ->whereRaw("{$last} is null"),
            self::STATUS_OVERDUE => $query->where(function (Builder $group) use ($overdueOn, $todayDate, $last, $latestDue): void {
                $group->where(function (Builder $override) use ($todayDate): void {
                    $override->whereNotNull('vso.next_due_on')
                        ->where('vso.next_due_on', '<', $todayDate);
                })->orWhere(function (Builder $explicit) use ($todayDate, $latestDue): void {
                    $explicit->whereNull('vso.next_due_on')
                        ->whereRaw("{$latestDue} is not null")
                        ->whereRaw("{$latestDue} < ?", [$todayDate]);
                })->orWhere(function (Builder $legacy) use ($overdueOn, $last, $latestDue): void {
                    $legacy->whereNull('vso.next_due_on')
                        ->whereRaw("{$latestDue} is null")
                        ->whereRaw("{$last} < ?", [$overdueOn]);
                });
            }),
            self::STATUS_DUE_SOON => $query->where(function (Builder $group) use ($todayDate, $windowEnd, $overdueOn, $dueSoonOn, $last, $latestDue): void {
                $group->where(function (Builder $override) use ($todayDate, $windowEnd): void {
                    $override->whereNotNull('vso.next_due_on')
                        ->where('vso.next_due_on', '>=', $todayDate)
                        ->where('vso.next_due_on', '<=', $windowEnd);
                })->orWhere(function (Builder $explicit) use ($todayDate, $windowEnd, $latestDue): void {
                    $explicit->whereNull('vso.next_due_on')
                        ->whereRaw("{$latestDue} >= ?", [$todayDate])
                        ->whereRaw("{$latestDue} <= ?", [$windowEnd]);
                })->orWhere(function (Builder $legacy) use ($overdueOn, $dueSoonOn, $last, $latestDue): void {
                    $legacy->whereNull('vso.next_due_on')
                        ->whereRaw("{$latestDue} is null")
                        ->whereRaw("{$last} >= ?", [$overdueOn])
                        ->whereRaw("{$last} <= ?", [$dueSoonOn]);
                });
            }),
            self::STATUS_SCHEDULED => $query->where(function (Builder $group) use ($windowEnd, $dueSoonOn, $last, $latestDue): void {
                $group->where(function (Builder $override) use ($windowEnd): void {
                    $override->whereNotNull('vso.next_due_on')
                        ->where('vso.next_due_on', '>', $windowEnd);
                })->orWhere(function (Builder $explicit) use ($windowEnd, $latestDue): void {
                    $explicit->whereNull('vso.next_due_on')
                        ->whereRaw("{$latestDue} > ?", [$windowEnd]);
                })->orWhere(function (Builder $legacy) use ($dueSoonOn, $last, $latestDue): void {
                    $legacy->whereNull('vso.next_due_on')
                        ->whereRaw("{$latestDue} is null")
                        ->whereRaw("{$last} > ?", [$dueSoonOn]);
                });
            }),
            default => null,
        };
    }

    /**
     * The newest vaccination's explicitly stored next-due date, but only when
     * that vaccination is at least as recent as the legacy monitoring date.
     * This keeps mixed legacy/new histories from letting an older vaccination
     * outvote a newer monitoring visit.
     */
    public static function latestVaccinationNextDueSql(): string
    {
        return '(select vd.next_due_on from vaccinations vd'
            .' where vd.beneficiary_id = beneficiaries.id and vd.deleted_at is null'
            .' and vd.next_due_on is not null'
            .' and vd.administered_on >= coalesce((select date(max(mr2.vaccination_date))'
            .' from monitoring_records mr2 where mr2.beneficiary_id = beneficiaries.id'
            .' and mr2.deleted_at is null and mr2.vaccination_date is not null), \'1000-01-01\')'
            .' order by vd.administered_on desc, vd.id desc limit 1)';
    }

    protected function saveOverride(
        Beneficiary $beneficiary,
        string $nextDue,
        ?string $reason,
        int $updatedBy,
    ): VaccinationScheduleOverride {
        return VaccinationScheduleOverride::updateOrCreate(
            ['beneficiary_id' => $beneficiary->id],
            [
                'next_due_on' => $nextDue,
                'reason' => $reason,
                'updated_by' => $updatedBy,
            ],
        );
    }
}
