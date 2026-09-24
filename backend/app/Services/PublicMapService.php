<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use Carbon\CarbonImmutable;
use Database\Factories\BeneficiaryFactory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Aggregated, PII-free program statistics for the public landing page map.
 *
 * The landing page has no session, so everything this service returns is
 * derived from barangay-level aggregates only: how many animals were
 * dispersed per barangay and the program totals. Farmer names and exact farm
 * coordinates never leave the server through this path — the pin positions
 * are the fixed barangay centroids from BeneficiaryFactory::BARANGAY_COORDS
 * (the same table the geocoder falls back to), rounded further to ~110 m.
 *
 * PublicMapSummaryTest asserts the privacy guarantee, so a refactor that
 * starts leaking identity fields fails CI rather than the news.
 */
class PublicMapService
{
    public const CACHE_KEY = 'public-map-summary';

    /** Fallback view when no barangay has rows yet: Bayawan City centre. */
    public const FALLBACK_CENTER = ['lat' => 9.3638, 'lng' => 122.8022];

    /**
     * Program summary for the public map, cached briefly so anonymous page
     * views cannot become a query amplifier.
     *
     * @return array{barangays: list<array{name: string, lat: float, lng: float, count: int}>, totals: array{beneficiaries: int, geo_tagged: int, re_dispersals: int, vaccinations_due: int}, center: array{lat: float, lng: float}, generated_at: string}
     */
    public function summary(): array
    {
        return Cache::remember(self::CACHE_KEY, now()->addMinutes(5), fn (): array => $this->build());
    }

    /**
     * @return array{barangays: list<array{name: string, lat: float, lng: float, count: int}>, totals: array{beneficiaries: int, geo_tagged: int, re_dispersals: int, vaccinations_due: int}, center: array{lat: float, lng: float}, generated_at: string}
     */
    protected function build(): array
    {
        $perBarangay = Beneficiary::query()
            ->select('address', DB::raw('count(*) as total'))
            ->groupBy('address')
            ->pluck('total', 'address');

        $barangays = [];

        foreach (BeneficiaryFactory::BARANGAY_COORDS as $name => [$lat, $lng]) {
            $count = (int) ($perBarangay[$name] ?? 0);

            if ($count === 0) {
                continue;
            }

            $barangays[] = [
                'name' => $name,
                // Rounded further from the centroid (~110 m): the public map
                // shows volume per area, never a farm's actual position.
                'lat' => round((float) $lat, 3),
                'lng' => round((float) $lng, 3),
                'count' => $count,
            ];
        }

        return [
            'barangays' => $barangays,
            'totals' => [
                'beneficiaries' => Beneficiary::count(),
                'geo_tagged' => Beneficiary::whereNotNull('latitude')->whereNotNull('longitude')->count(),
                're_dispersals' => DispersalEvent::query()
                    ->where('dispersal_type', DispersalEvent::TYPE_RE_DISPERSAL)
                    ->count(),
                'vaccinations_due' => $this->vaccinationsDue(),
            ],
            'center' => $this->centerFor($barangays),
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /**
     * Animals due (or overdue, or never vaccinated) for their next shot.
     *
     * Same thresholds as VaccinationScheduleService::scheduleFor(), expressed
     * against the same correlated subquery the schedule endpoint orders by —
     * the landing page's number cannot disagree with the doctor's list.
     */
    protected function vaccinationsDue(): int
    {
        $last = VaccinationScheduleService::lastVaccinationSql();

        // A vaccination on or before this date means the animal is never,
        // overdue or due-soon today (due-soon includes overdue: the window
        // boundary is later than the overdue boundary).
        $dueBy = CarbonImmutable::now()->startOfDay()
            ->addDays((int) config('cvo.vaccination_due_soon_days'))
            ->subDays((int) config('cvo.vaccination_interval_days'))
            ->toDateString();

        return Beneficiary::query()
            ->whereRaw("({$last} is null or {$last} <= ?)", [$dueBy])
            ->count();
    }

    /**
     * Mean of the visible barangay pins, so the map opens framed on the
     * coverage rather than the whole island.
     *
     * @param  list<array{name: string, lat: float, lng: float, count: int}>  $barangays
     * @return array{lat: float, lng: float}
     */
    protected function centerFor(array $barangays): array
    {
        if ($barangays === []) {
            return self::FALLBACK_CENTER;
        }

        return [
            'lat' => round(array_sum(array_column($barangays, 'lat')) / count($barangays), 4),
            'lng' => round(array_sum(array_column($barangays, 'lng')) / count($barangays), 4),
        ];
    }
}
