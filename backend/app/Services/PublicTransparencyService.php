<?php

namespace App\Services;

use App\Models\AnimalOwnershipEvent;
use App\Models\Barangay;
use App\Models\Beneficiary;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Aggregate, identity-free program statistics for the public transparency
 * dashboard (`/transparency`).
 *
 * SAME SOURCE AS THE ADMIN ANALYTICS: every dispersal number here comes from
 * `animal_ownership_events` (active rows only — voided events are excluded),
 * using the same per-barangay definitions as
 * BarangayDispersalAnalyticsService. The public page and Reports → Barangay
 * dispersal therefore cannot disagree: with the same fixture, the public
 * "animals dispersed" total equals the admin tab's city "Dispersed" total
 * (PublicTransparencyTest pins that equality).
 *
 * Same privacy boundary as PublicMapService, and for the same reason: the page
 * has no session, so nothing here may identify a person or a farm. Every number
 * is a count at BARANGAY level or city level — no farmer names, no household
 * ids, no farm coordinates, no individual records. PublicTransparencyTest
 * enforces that boundary, so a refactor that starts leaking identity fields
 * fails CI.
 *
 * Field names say what the numbers mean:
 *   animals_dispersed  active `dispersal` events delivered into the barangay
 *                      (a count of ANIMALS placed, not households)
 *   re_dispersals      active `re_dispersal` + `pass_on` events whose SOURCE
 *                      barangay sits there (the admin tab's "Re-dispersed out")
 *   households         Beneficiary::count() — HOUSEHOLDS, never animals
 *
 * Cached briefly so anonymous page views cannot become a query amplifier.
 */
class PublicTransparencyService
{
    public const CACHE_KEY = 'public-transparency:v2';

    public function __construct(private readonly SettingsService $settings) {}

    /** How many recent months the reach trend covers. */
    private const REACH_MONTHS = 12;

    /**
     * @return array{
     *     totals: array{animals_dispersed: int, barangays_covered: int, re_dispersals: int, households: int},
     *     per_barangay: list<array{name: string, animals_dispersed: int, re_dispersals: int}>,
     *     reach_over_time: list<array{month: string, animals_dispersed: int}>,
     *     vaccination: array{compliant: int, total: int, rate: float|null},
     *     generated_at: string
     * }
     */
    public function summary(): array
    {
        return Cache::remember(self::CACHE_KEY, now()->addMinutes(5), fn (): array => $this->build());
    }

    /**
     * @return array{totals: array{animals_dispersed: int, barangays_covered: int, re_dispersals: int, households: int}, per_barangay: list<array{name: string, animals_dispersed: int, re_dispersals: int}>, reach_over_time: list<array{month: string, animals_dispersed: int}>, vaccination: array{compliant: int, total: int, rate: float|null}, generated_at: string}
     */
    protected function build(): array
    {
        $perBarangay = $this->perBarangay();

        return [
            'totals' => [
                // A count of ANIMALS placed (dispersal events), not households.
                'animals_dispersed' => (int) array_sum(array_column($perBarangay, 'animals_dispersed')),
                // Barangays that received at least one animal.
                'barangays_covered' => count(array_filter(
                    $perBarangay,
                    fn (array $row): bool => $row['animals_dispersed'] > 0,
                )),
                're_dispersals' => (int) array_sum(array_column($perBarangay, 're_dispersals')),
                // Households, deliberately separate from animals_dispersed.
                'households' => Beneficiary::count(),
            ],
            'per_barangay' => $perBarangay,
            'reach_over_time' => $this->reachOverTime(),
            'vaccination' => $this->vaccinationCompliance(),
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /**
     * Every covered barangay with at least one recorded event, busiest first.
     *
     * Definitions mirror BarangayDispersalAnalyticsService exactly:
     *   animals_dispersed  active `dispersal` events with the barangay as the
     *                      destination (to_barangay_id snapshot)
     *   re_dispersals      active `re_dispersal` + `pass_on` events whose
     *                      SOURCE barangay (from_barangay_id snapshot) sits
     *                      there — the admin tab's "Re-dispersed out"
     *
     * @return list<array{name: string, animals_dispersed: int, re_dispersals: int}>
     */
    protected function perBarangay(): array
    {
        $dispersed = $this->activeEvents()
            ->where('e.event_type', AnimalOwnershipEvent::TYPE_DISPERSAL)
            ->whereNotNull('e.to_barangay_id')
            ->groupBy('e.to_barangay_id')
            ->selectRaw('e.to_barangay_id as barangay_id, count(*) as total')
            ->pluck('total', 'barangay_id');

        $reDispersalTypes = [
            AnimalOwnershipEvent::TYPE_RE_DISPERSAL,
            AnimalOwnershipEvent::TYPE_PASS_ON,
        ];

        $passedOn = $this->activeEvents()
            ->whereIn('e.event_type', $reDispersalTypes)
            ->whereNotNull('e.from_barangay_id')
            ->groupBy('e.from_barangay_id')
            ->selectRaw('e.from_barangay_id as barangay_id, count(*) as total')
            ->pluck('total', 'barangay_id');

        return Barangay::query()
            ->orderBy('id')
            ->selectRaw('id, name')
            ->get()
            ->map(fn (Barangay $barangay): array => [
                'name' => $barangay->name,
                'animals_dispersed' => (int) ($dispersed[$barangay->id] ?? 0),
                're_dispersals' => (int) ($passedOn[$barangay->id] ?? 0),
            ])
            ->filter(fn (array $row): bool => $row['animals_dispersed'] > 0 || $row['re_dispersals'] > 0)
            ->sortByDesc('animals_dispersed')
            ->values()
            ->all();
    }

    /**
     * Program reach per month over the last {@see REACH_MONTHS} months: the
     * animals dispersed each month, from the same active events.
     *
     * Grouped in PHP rather than with a driver-specific DATE_FORMAT/strftime so
     * the same code runs on MySQL and on the SQLite test database. `month` is
     * "YYYY-MM"; the series is oldest-first and includes every month in the
     * window (zero-filled) so a chart shows gaps as gaps.
     *
     * @return list<array{month: string, animals_dispersed: int}>
     */
    protected function reachOverTime(): array
    {
        $start = CarbonImmutable::now()->startOfMonth()->subMonths(self::REACH_MONTHS - 1);

        $dispersed = $this->activeEvents()
            ->where('e.event_type', AnimalOwnershipEvent::TYPE_DISPERSAL)
            ->where('e.event_date', '>=', $start->toDateString())
            ->get(['e.event_date'])
            ->map(fn ($event) => CarbonImmutable::parse($event->event_date)->format('Y-m'))
            ->countBy();

        $series = [];

        for ($i = 0; $i < self::REACH_MONTHS; $i++) {
            $month = $start->addMonths($i)->format('Y-m');

            $series[] = [
                'month' => $month,
                'animals_dispersed' => (int) ($dispersed[$month] ?? 0),
            ];
        }

        return $series;
    }

    /**
     * City-wide vaccination compliance.
     *
     * Definition, deliberately plain and auditable: an animal is COMPLIANT when
     * its most recent recorded vaccination is within the program's interval
     * (i.e. it is neither never-vaccinated nor overdue). "Due soon" still counts
     * as compliant — it has a current shot, it is simply approaching renewal.
     * The boundary is the same one VaccinationScheduleService uses for OVERDUE
     * (last < today − interval), so this number cannot disagree with the
     * doctor's schedule.
     *
     * @return array{compliant: int, total: int, rate: float|null}
     */
    protected function vaccinationCompliance(): array
    {
        $last = VaccinationScheduleService::lastVaccinationSql();

        $overdueOn = CarbonImmutable::now()->startOfDay()
            ->subDays($this->settings->vaccinationIntervalDays())
            ->toDateString();

        $total = Beneficiary::count();

        $behind = Beneficiary::query()
            ->whereRaw("({$last} is null or {$last} < ?)", [$overdueOn])
            ->count();

        $compliant = max(0, $total - $behind);

        return [
            'compliant' => $compliant,
            'total' => $total,
            'rate' => $total > 0 ? round($compliant / $total, 4) : null,
        ];
    }

    /**
     * The one base query every dispersal number starts from: ACTIVE ownership
     * events only (voided rows excluded) — the same boundary the admin
     * analytics draws.
     *
     * @return \Illuminate\Database\Query\Builder
     */
    protected function activeEvents(): \Illuminate\Database\Query\Builder
    {
        return DB::table('animal_ownership_events as e')
            ->where('e.status', AnimalOwnershipEvent::STATUS_ACTIVE);
    }
}
