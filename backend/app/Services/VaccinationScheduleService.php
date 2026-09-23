<?php

namespace App\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

/**
 * Vaccination schedule — a derived, read-only view.
 *
 * Deliberately NOT a table. An animal's last vaccination is already recorded
 * on `monitoring_records.vaccination_date` (written by the field forms and by
 * the CVO Excel import), so the next due date is arithmetic on data that
 * already exists. Storing it alongside would create a second source of truth
 * that drifts the moment a visit is back-dated or corrected — and the brief's
 * own rule is to build on existing records rather than invent source tables.
 *
 * The cycle length lives in config/cvo.php. Per-species cycles are the point
 * at which this stops being config and becomes real data.
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

    public function __construct(private readonly BeneficiaryService $beneficiaries) {}

    public function intervalDays(): int
    {
        return (int) config('cvo.vaccination_interval_days');
    }

    public function dueSoonDays(): int
    {
        return (int) config('cvo.vaccination_due_soon_days');
    }

    /**
     * Role-scoped schedule, most urgent first.
     *
     * Never-vaccinated and longest-overdue animals lead, which is the order a
     * field team actually works through.
     */
    public function listFor(User $user, ?string $status = null, int $perPage = 15): LengthAwarePaginator
    {
        $last = self::lastVaccinationSql();

        $query = $this->beneficiaries->scopeQueryFor($user)
            ->with(['technician', 'farmer'])
            ->select('beneficiaries.*')
            ->selectRaw("{$last} as last_vaccination_date")
            ->orderByRaw("{$last} is null desc")
            ->orderByRaw("{$last} asc")
            ->orderBy('name_of_farmer');

        $this->applyStatusFilter($query, $status, $last);

        return $query->paginate($perPage);
    }

    /**
     * Whether a beneficiary's recorded vaccinations match the requested status.
     *
     * Exposed so the filter and the per-row status computed in the resource
     * are driven by the same thresholds — a mismatch here would show a row in
     * the "overdue" list labelled "due soon".
     */
    public function matchesStatus(?string $lastVaccination, string $status): bool
    {
        return self::scheduleFor($lastVaccination)['status'] === $status;
    }

    /**
     * Derived schedule fields for one animal.
     *
     * @return array{last_vaccination_date: ?string, next_due_date: ?string, days_until_due: ?int, status: string}
     */
    public static function scheduleFor(?string $lastVaccination): array
    {
        $interval = (int) config('cvo.vaccination_interval_days');
        $window = (int) config('cvo.vaccination_due_soon_days');

        if (! $lastVaccination) {
            return [
                'last_vaccination_date' => null,
                'next_due_date' => null,
                'days_until_due' => null,
                'status' => self::STATUS_NEVER,
            ];
        }

        $today = CarbonImmutable::now()->startOfDay();
        $last = CarbonImmutable::parse($lastVaccination)->startOfDay();
        $nextDue = $last->addDays($interval);

        // Whole days between the two dates, from timestamps rather than
        // diffInDays(), so the sign and the rounding are unambiguous.
        $daysUntilDue = (int) floor(($nextDue->getTimestamp() - $today->getTimestamp()) / 86400);

        $status = match (true) {
            $daysUntilDue < 0 => self::STATUS_OVERDUE,
            $daysUntilDue <= $window => self::STATUS_DUE_SOON,
            default => self::STATUS_SCHEDULED,
        };

        return [
            'last_vaccination_date' => $last->toDateString(),
            'next_due_date' => $nextDue->toDateString(),
            'days_until_due' => $daysUntilDue,
            'status' => $status,
        ];
    }

    /**
     * The correlated subquery for an animal's most recent vaccination.
     *
     * Two deliberate choices, both learned the hard way:
     *
     * 1. Written out rather than using withMax() because the same expression
     *    has to appear in the SELECT, the ORDER BY *and* the WHERE clause — and
     *    MySQL rejects a SELECT alias in WHERE. SQLite accepts it, so an
     *    alias-based filter would pass the whole suite and fail in production.
     *
     * 2. Wrapped in date() because the `date` cast writes `Y-m-d H:i:s`. MySQL
     *    truncates that into its DATE column, but SQLite keeps it verbatim —
     *    and then `'2026-04-26 00:00:00' <= '2026-04-26'` is false, so a row
     *    sitting exactly on a due-date boundary silently fell out of the
     *    filter. Normalising here makes the comparison the same on both
     *    drivers and immune to the column being widened to a datetime later.
     */
    public static function lastVaccinationSql(): string
    {
        return '(select date(max(mr.vaccination_date)) from monitoring_records mr'
            .' where mr.beneficiary_id = beneficiaries.id and mr.vaccination_date is not null)';
    }

    /**
     * Restrict to one status, using thresholds identical to scheduleFor().
     *
     *   days_until_due <  0            ⇔ last < today − interval
     *   0 ≤ days_until_due ≤ window    ⇔ today − interval ≤ last ≤ today + window − interval
     *   days_until_due >  window       ⇔ last > today + window − interval
     */
    protected function applyStatusFilter(Builder $query, ?string $status, string $last): void
    {
        if ($status === null) {
            return;
        }

        $today = CarbonImmutable::now()->startOfDay();

        // A vaccination on or before this date is overdue today.
        $overdueOn = $today->subDays($this->intervalDays())->toDateString();

        // A vaccination on or before this date comes due within the window.
        $dueSoonOn = $today->addDays($this->dueSoonDays())
            ->subDays($this->intervalDays())
            ->toDateString();

        match ($status) {
            self::STATUS_NEVER => $query->whereRaw("{$last} is null"),
            self::STATUS_OVERDUE => $query->whereRaw("{$last} < ?", [$overdueOn]),
            self::STATUS_DUE_SOON => $query
                ->whereRaw("{$last} >= ?", [$overdueOn])
                ->whereRaw("{$last} <= ?", [$dueSoonOn]),
            self::STATUS_SCHEDULED => $query->whereRaw("{$last} > ?", [$dueSoonOn]),
            default => null,
        };
    }
}
