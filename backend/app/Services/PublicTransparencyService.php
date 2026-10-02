<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Aggregate, identity-free program statistics for the public transparency
 * dashboard (`/transparency`).
 *
 * Same privacy boundary as PublicMapService, and for the same reason: the page
 * has no session, so nothing here may identify a person or a farm. Every number
 * is a count at BARANGAY level or city level — no farmer names, no household
 * ids, no farm coordinates, no individual records. PublicTransparencyTest
 * enforces that boundary, so a refactor that starts leaking identity fields
 * fails CI.
 *
 * Cached briefly so anonymous page views cannot become a query amplifier.
 */
class PublicTransparencyService
{
    public const CACHE_KEY = 'public-transparency';

    /** How many recent months the reach trend covers. */
    private const REACH_MONTHS = 12;

    /**
     * @return array{
     *     totals: array{beneficiaries: int, barangays_covered: int, re_dispersals: int},
     *     per_barangay: list<array{name: string, beneficiaries: int, re_dispersals: int}>,
     *     reach_over_time: list<array{month: string, beneficiaries: int, dispersals: int}>,
     *     vaccination: array{compliant: int, total: int, rate: float|null},
     *     generated_at: string
     * }
     */
    public function summary(): array
    {
        return Cache::remember(self::CACHE_KEY, now()->addMinutes(5), fn (): array => $this->build());
    }

    /**
     * @return array{totals: array{beneficiaries: int, barangays_covered: int, re_dispersals: int}, per_barangay: list<array{name: string, beneficiaries: int, re_dispersals: int}>, reach_over_time: list<array{month: string, beneficiaries: int, dispersals: int}>, vaccination: array{compliant: int, total: int, rate: float|null}, generated_at: string}
     */
    protected function build(): array
    {
        $reDispersals = DispersalEvent::query()
            ->where('dispersal_type', DispersalEvent::TYPE_RE_DISPERSAL)
            ->count();

        $perBarangay = $this->perBarangay();

        return [
            'totals' => [
                'beneficiaries' => Beneficiary::count(),
                'barangays_covered' => count($perBarangay),
                're_dispersals' => $reDispersals,
            ],
            'per_barangay' => $perBarangay,
            'reach_over_time' => $this->reachOverTime(),
            'vaccination' => $this->vaccinationCompliance(),
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /**
     * Beneficiaries and re-dispersals per barangay, busiest first.
     *
     * `beneficiaries` counts animals dispersed into the barangay; `re_dispersals`
     * counts pass-ons whose SOURCE household sits there (a re-dispersal is
     * credited to where the offspring came from).
     *
     * @return list<array{name: string, beneficiaries: int, re_dispersals: int}>
     */
    protected function perBarangay(): array
    {
        $beneficiaries = Beneficiary::query()
            ->select('address', DB::raw('count(*) as total'))
            ->groupBy('address')
            ->pluck('total', 'address');

        $passedOn = DispersalEvent::query()
            ->where('dispersal_type', DispersalEvent::TYPE_RE_DISPERSAL)
            ->join('beneficiaries as parents', 'parents.id', '=', 'dispersal_events.parent_beneficiary_id')
            ->whereNull('parents.deleted_at')
            ->select('parents.address', DB::raw('count(*) as total'))
            ->groupBy('parents.address')
            ->pluck('total', 'parents.address');

        $rows = [];

        foreach ($beneficiaries as $name => $total) {
            $rows[] = [
                'name' => (string) $name,
                'beneficiaries' => (int) $total,
                're_dispersals' => (int) ($passedOn[$name] ?? 0),
            ];
        }

        usort($rows, fn (array $a, array $b) => $b['beneficiaries'] <=> $a['beneficiaries']);

        return $rows;
    }

    /**
     * Program reach per month over the last {@see REACH_MONTHS} months.
     *
     * Grouped in PHP rather than with a driver-specific DATE_FORMAT/strftime so
     * the same code runs on MySQL and on the SQLite test database. `month` is
     * "YYYY-MM"; the series is oldest-first and includes every month in the
     * window (zero-filled) so a chart shows gaps as gaps.
     *
     * @return list<array{month: string, beneficiaries: int, dispersals: int}>
     */
    protected function reachOverTime(): array
    {
        $start = CarbonImmutable::now()->startOfMonth()->subMonths(self::REACH_MONTHS - 1);

        $byMonth = fn ($dates) => collect($dates)
            ->map(fn ($date) => CarbonImmutable::parse($date)->format('Y-m'))
            ->countBy();

        $beneficiaries = $byMonth(
            Beneficiary::query()
                ->where('created_at', '>=', $start)
                ->pluck('created_at'),
        );

        $dispersals = $byMonth(
            DispersalEvent::query()
                ->whereNotNull('date_dispersed')
                ->where('date_dispersed', '>=', $start->toDateString())
                ->pluck('date_dispersed'),
        );

        $series = [];

        for ($i = 0; $i < self::REACH_MONTHS; $i++) {
            $month = $start->addMonths($i)->format('Y-m');

            $series[] = [
                'month' => $month,
                'beneficiaries' => (int) ($beneficiaries[$month] ?? 0),
                'dispersals' => (int) ($dispersals[$month] ?? 0),
            ];
        }

        return $series;
    }

    /**
     * City-wide vaccination compliance.
     *
     * Definition, deliberately plain and auditable: an animal is COMPLIANT when
     * its most recent recorded vaccination is within the programme's interval
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
            ->subDays((int) config('cvo.vaccination_interval_days'))
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
}
