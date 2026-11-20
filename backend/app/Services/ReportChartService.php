<?php

namespace App\Services;

use App\Models\AnimalOwnershipEvent;
use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use App\Support\Barangays;
use Illuminate\Support\Carbon;

/**
 * The five chart aggregations behind the Reports screen — one dedicated
 * method per chart, every number computed in the DATABASE query (grouped
 * COUNT queries; month buckets via portable substr), never by shipping raw
 * rows anywhere. The public transparency dashboard uses the same
 * compute-server-side approach, so both surfaces answer with the same
 * methods and cannot disagree.
 *
 * Month bucketing uses `substr(date, 1, 7)` ("YYYY-MM") rather than
 * MONTH()/strftime: MonitoringRecordService already buckets that way, and it
 * is the one formulation that reads identically on MySQL (production) and
 * SQLite (the test suite).
 *
 * Zero-filling happens in PHP: months/barangays with no rows still appear
 * with zero so a trend reads as a trend and a barangay with zero records
 * cannot break the chart — the fill is over the BUCKETS, never the data.
 */
class ReportChartService
{
    /** Default trailing window for the time-series charts. */
    public const TREND_MONTHS = 12;

    public function __construct(private readonly SettingsService $settings) {}

    /**
     * Chart 1 — dispersal trend over time (line). Monthly dispersal counts
     * (initial + re-dispersals split) between `from`/`to`, defaulting to the
     * trailing window. Respects the barangay and animal-type filters.
     *
     * @return list<array{month: string, label: string, dispersals: int, re_dispersals: int}>
     */
    public function dispersalTrend(
        ?string $barangay = null,
        ?string $animalType = null,
        ?string $from = null,
        ?string $to = null,
        ?string $category = null,
        ?string $beneficiary = null,
        ?string $dispersalType = null,
    ): array {
        // The window: explicit range, else the trailing months. Boundary
        // months are INCLUSIVE, so the count matches what the per-barangay
        // table sums to for the same period.
        $start = $from !== null
            ? Carbon::parse($from)->startOfMonth()
            : Carbon::now()->startOfMonth()->subMonths(self::TREND_MONTHS - 1);
        $end = $to !== null ? Carbon::parse($to)->endOfMonth() : Carbon::now()->endOfMonth();

        $rows = $this->dispersalQuery($barangay, $animalType, $category, $beneficiary, $dispersalType)
            ->whereBetween('animal_ownership_events.event_date', [$start->toDateString(), $end->toDateString()])
            ->selectRaw('substr(animal_ownership_events.event_date, 1, 7) as month')
            ->selectRaw('count(*) as dispersals')
            ->selectRaw('sum(case when animal_ownership_events.event_type = ? then 1 else 0 end) as re_dispersals', [AnimalOwnershipEvent::TYPE_RE_DISPERSAL])
            ->groupBy('month')
            ->get()
            ->mapWithKeys(fn ($row) => [$row->month => $row]);

        $months = [];

        // Bounded walk: start and end are month-aligned, so a normal range
        // terminates in (months between) steps; an inverted range (from > to)
        // simply produces an empty series rather than a loop.
        for ($cursor = $start->copy(); $cursor->lessThanOrEqualTo($end); $cursor->addMonth()) {
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
     * Chart 2 — animals dispersed by barangay (bar). One grouped query;
     * every barangay appears, zero-filled, so a quiet barangay is a zero bar
     * rather than an absent row.
     *
     * @return list<array{barangay: string, dispersals: int, re_dispersals: int}>
     */
    public function animalsByBarangay(
        ?string $animalType = null,
        ?string $from = null,
        ?string $to = null,
        ?string $category = null,
        ?string $beneficiary = null,
        ?string $dispersalType = null,
    ): array {
        $rows = $this->dispersalQuery(null, $animalType, $category, $beneficiary, $dispersalType)
            ->when($from !== null, fn ($q) => $q->where('animal_ownership_events.event_date', '>=', $from))
            ->when($to !== null, fn ($q) => $q->where('animal_ownership_events.event_date', '<=', $to))
            ->join('barangays as destination_barangays', 'destination_barangays.id', '=', 'animal_ownership_events.to_barangay_id')
            ->whereNotNull('animal_ownership_events.to_barangay_id')
            ->selectRaw('destination_barangays.name as barangay')
            ->selectRaw('count(*) as dispersals')
            ->selectRaw('sum(case when animal_ownership_events.event_type = ? then 1 else 0 end) as re_dispersals', [AnimalOwnershipEvent::TYPE_RE_DISPERSAL])
            ->groupBy('destination_barangays.name')
            ->get()
            ->mapWithKeys(fn ($row) => [$row->barangay => $row]);

        return collect(Barangays::all())
            ->map(fn (string $barangay): array => [
                'barangay' => $barangay,
                'dispersals' => (int) ($rows[$barangay]->dispersals ?? 0),
                're_dispersals' => (int) ($rows[$barangay]->re_dispersals ?? 0),
            ])
            ->all();
    }

    /**
     * Chart 3 — vaccination compliance over time (line). For each month end:
     * the share of animals registered by then whose latest recorded
     * vaccination was inside the administrator's cycle at that month end.
     * Compliant = a vaccination dated within `vaccination_interval_days`
     * before the month end — the same definition the Vaccination Schedule
     * and the smart-alert scan use, via the same SettingsService number.
     *
     * Historical scope is honest about its limit: it counts animals still in
     * the system (deletions are not reconstructed), and compliance at a past
     * month end uses the CURRENT cycle length, not whatever it was then.
     *
     * @return list<array{month: string, label: string, total: int, compliant: int, rate: float}>
     */
    public function vaccinationCompliance(
        ?string $barangay = null,
        ?string $animalType = null,
        ?int $months = null,
        ?string $beneficiary = null,
    ): array
    {
        $interval = $this->settings->vaccinationIntervalDays();
        $window = max(1, min(24, $months ?? self::TREND_MONTHS));

        $out = [];

        for ($i = $window - 1; $i >= 0; $i--) {
            $end = Carbon::now()->startOfMonth()->subMonths($i)->endOfMonth();
            $windowStart = $end->copy()->subDays($interval)->toDateString();

            $row = Beneficiary::query()
                ->where('created_at', '<=', $end)
                ->when($barangay !== null && $barangay !== '', fn ($q) => $q->where('address', $barangay))
                ->when($animalType !== null && $animalType !== '', fn ($q) => $q->where('animal_type', $animalType))
                ->when($beneficiary !== null && $beneficiary !== '', fn ($q) => $q->where(function ($search) use ($beneficiary): void {
                    $like = '%'.$beneficiary.'%';
                    $search->where('name_of_farmer', 'like', $like)
                        ->orWhere('rsbsa_number', 'like', $like)
                        ->orWhere('ear_tag_number', 'like', $like);
                }))
                ->selectRaw('count(*) as total')
                ->selectRaw('sum(case when exists (
                    select 1 from monitoring_records mr
                    where mr.beneficiary_id = beneficiaries.id
                      and mr.deleted_at is null
                      and mr.vaccination_date between ? and ?
                ) then 1 else 0 end) as compliant', [$windowStart, $end->toDateString()])
                ->first();

            $total = (int) ($row->total ?? 0);
            $compliant = (int) ($row->compliant ?? 0);

            $out[] = [
                'month' => $end->format('Y-m'),
                'label' => $end->format('M Y'),
                'total' => $total,
                'compliant' => $compliant,
                // Round to a clean percentage; null when nothing was
                // registered yet so the chart shows a gap, not a lie.
                'rate' => $total > 0 ? round($compliant / $total * 100, 1) : null,
            ];
        }

        return $out;
    }

    /**
     * Chart 4 — animal type distribution (donut). Monitoring records grouped
     * by the beneficiary's animal type, respecting the same month/year filter
     * the Monitoring Records screen uses (bucketed on `date_monitored`).
     *
     * @return list<array{animal_type: string, animals: int}>
     */
    public function animalTypeDistribution(
        ?string $month = null,
        ?string $from = null,
        ?string $to = null,
        ?string $beneficiary = null,
    ): array {
        return MonitoringRecord::query()
            ->join('beneficiaries', 'beneficiaries.id', '=', 'monitoring_records.beneficiary_id')
            ->whereNull('beneficiaries.deleted_at')
            ->when($beneficiary !== null && $beneficiary !== '', fn ($q) => $q->where(function ($search) use ($beneficiary): void {
                $like = '%'.$beneficiary.'%';
                $search->where('beneficiaries.name_of_farmer', 'like', $like)
                    ->orWhere('beneficiaries.rsbsa_number', 'like', $like)
                    ->orWhere('beneficiaries.ear_tag_number', 'like', $like);
            }))
            ->when($month !== null && $month !== '', fn ($q) => $q->whereRaw('substr(monitoring_records.date_monitored, 1, 7) = ?', [$month]))
            ->when($from !== null, fn ($q) => $q->where('monitoring_records.date_monitored', '>=', $from))
            ->when($to !== null, fn ($q) => $q->where('monitoring_records.date_monitored', '<=', $to))
            ->selectRaw('coalesce(beneficiaries.animal_type, :unspecified) as animal_type', ['unspecified' => 'Unspecified'])
            ->selectRaw('count(*) as animals')
            ->groupBy('animal_type')
            ->orderByDesc('animals')
            ->get()
            ->map(fn ($row): array => [
                'animal_type' => $row->animal_type,
                'animals' => (int) $row->animals,
            ])
            ->all();
    }

    /**
     * Chart 5 — technician workload (bar): active households currently
     * assigned to each technician, zero-filled so an unassigned technician
     * shows as zero rather than disappearing.
     *
     * @return list<array{technician: string, households: int}>
     */
    public function technicianWorkload(?string $barangay = null, ?string $beneficiary = null): array
    {
        $rows = User::query()
            ->leftJoin('beneficiaries', function ($join): void {
                $join->on('users.id', '=', 'beneficiaries.technician_id')
                    ->whereNull('beneficiaries.deleted_at');
            })
            ->when($barangay !== null && $barangay !== '', fn ($q) => $q->where('beneficiaries.address', $barangay))
            ->when($beneficiary !== null && $beneficiary !== '', fn ($q) => $q->where(function ($search) use ($beneficiary): void {
                $like = '%'.$beneficiary.'%';
                $search->where('beneficiaries.name_of_farmer', 'like', $like)
                    ->orWhere('beneficiaries.rsbsa_number', 'like', $like)
                    ->orWhere('beneficiaries.ear_tag_number', 'like', $like);
            }))
            ->where('users.role', 'technician')
            ->whereNull('users.deleted_at')
            ->selectRaw('users.id as user_id, users.name as technician')
            ->selectRaw('count(beneficiaries.id) as households')
            ->groupBy('users.id', 'users.name')
            ->get()
            ->map(fn ($row): array => [
                'technician' => $row->technician,
                'households' => (int) $row->households,
            ])
            ->sortByDesc('households')
            ->values()
            ->all();

        return $rows;
    }

    /**
     * Dispersal counts joined to the beneficiary's barangay and animal type,
     * with the SoftDeletes filters written explicitly — raw joins bypass
     * Eloquent's global scope, the same trap perBarangaySection documents.
     */
    private function dispersalQuery(
        ?string $barangay,
        ?string $animalType,
        ?string $category = null,
        ?string $beneficiary = null,
        ?string $dispersalType = null,
    ) {
        return AnimalOwnershipEvent::query()
            ->where('status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->whereIn('event_type', [
                AnimalOwnershipEvent::TYPE_DISPERSAL,
                AnimalOwnershipEvent::TYPE_RE_DISPERSAL,
                AnimalOwnershipEvent::TYPE_PASS_ON,
            ])
            ->when($barangay !== null && $barangay !== '', fn ($q) => $q->whereHas(
                'toBeneficiary',
                fn ($beneficiary) => $beneficiary->where('address', $barangay),
            ))
            ->when($animalType !== null && $animalType !== '', fn ($q) => $q->whereHas(
                'animal',
                fn ($animal) => $animal->where(function ($value) use ($animalType): void {
                    $value->where('animal_type', $animalType)
                        ->orWhereHas('animalType', fn ($type) => $type->where('name', $animalType));
                }),
            ))
            ->when($category !== null && $category !== '', fn ($q) => $q->whereHas(
                'animal.animalType',
                fn ($type) => $type->where('main_category', $category),
            ))
            ->when($beneficiary !== null && $beneficiary !== '', fn ($q) => $q->whereHas(
                'toBeneficiary',
                fn ($b) => $b->where(function ($search) use ($beneficiary): void {
                    $like = '%'.$beneficiary.'%';
                    $search->where('name_of_farmer', 'like', $like)
                        ->orWhere('rsbsa_number', 'like', $like)
                        ->orWhere('ear_tag_number', 'like', $like);
                }),
            ))
            ->when($dispersalType !== null && $dispersalType !== '', fn ($q) => $q->where('event_type', $dispersalType));
    }
}
