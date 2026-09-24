<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Support\Barangays;
use App\Models\CaseNote;
use App\Models\DispersalEvent;
use App\Models\FieldVisit;
use App\Models\HealthRecord;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * City-wide program reporting — one aggregated read over the tables that
 * already exist.
 *
 * Like every derived screen in this system there is no report table and
 * nothing to encode: the counts restate Beneficiary, MonitoringRecord,
 * DispersalEvent, FieldVisit, HealthRecord and CaseNote rows. The admin
 * dashboard already offers the monitoring workbook import/export; this is the
 * complement — a single page answering "how big is the program, how active is
 * it, and where does it need attention" without exporting anything.
 *
 * Aggregates are counted per barangay because the barangay is how the office
 * plans and reports upward; every other number on the page is a sum that can
 * be checked against the barangay rows, so the page cannot quietly disagree
 * with itself.
 */
class ReportService
{
    /** Trailing months shown in the dispersal trend. */
    public const TREND_MONTHS = 6;

    public function __construct(private readonly BeneficiaryService $beneficiaries) {}

    /**
     * The full city-wide report, optionally narrowed to one barangay.
     *
     * @return array<string, mixed>
     */
    public function cityWide(User $viewer, ?string $barangay = null, ?Carbon $from = null): array
    {
        // Admin sees the whole program; the scoping service is reused anyway
        // so the report's numbers can never exceed the viewer's real scope.
        $beneficiaries = $this->beneficiaries->scopeQueryFor($viewer);

        if ($barangay !== null && $barangay !== '') {
            $beneficiaries->where('address', $barangay);
        }

        $base = clone $beneficiaries;

        return [
            'scope' => [
                'barangay' => $barangay,
                'barangays' => Barangays::all(),
            ],
            'program' => $this->programSection($base),
            'activity' => $this->activitySection($barangay, $from),
            'clinical' => $this->clinicalSection($barangay),
            'per_barangay' => $this->perBarangaySection(),
            'trend' => $this->trendSection($barangay),
        ];
    }

    /**
     * Program size: households and animals under the program, and how much of
     * it is actively looked after (a technician assigned) versus unassigned.
     */
    private function programSection($base): array
    {
        return [
            'households' => (clone $base)->count(),
            'animals' => (clone $base)->count(),
            'with_technician' => (clone $base)->whereNotNull('technician_id')->count(),
            'unassigned' => (clone $base)->whereNull('technician_id')->count(),
        ];
    }

    /**
     * Field activity: the two visit logs and the dispersal movements.
     * Barangay filtering rides on the beneficiary relation so a barangay view
     * and the city total are computed the same way.
     */
    private function activitySection(?string $barangay, ?Carbon $from): array
    {
        $monitoring = MonitoringRecord::query()
            ->whereHas('beneficiary', $this->barangayFilter($barangay));

        $visits = FieldVisit::query()
            ->whereHas('beneficiary', $this->barangayFilter($barangay));

        $dispersals = DispersalEvent::query()
            ->whereHas('beneficiary', $this->barangayFilter($barangay));

        $sections = [
            'monitoring_visits' => (clone $monitoring)->count(),
            'field_visits' => (clone $visits)->count(),
            'field_visits_with_location' => (clone $visits)
                ->whereNotNull('latitude')->whereNotNull('longitude')->count(),
            'dispersals' => (clone $dispersals)->count(),
            're_dispersals' => (clone $dispersals)
                ->where('dispersal_type', DispersalEvent::TYPE_RE_DISPERSAL)->count(),
        ];

        if ($from !== null) {
            $sections['dispersals_since'] = (clone $dispersals)
                ->where('date_dispersed', '>=', $from->toDateString())->count();
        }

        return $sections;
    }

    /**
     * Clinical load: outcomes vocabulary from config (the same list the
     * health record form offers), so the report cannot name an outcome the
     * system does not use.
     */
    private function clinicalSection(?string $barangay): array
    {
        $health = HealthRecord::query()
            ->whereHas('beneficiary', $this->barangayFilter($barangay));

        $byOutcome = [];
        $openOutcomes = config('cvo.health_open_outcomes', []);

        foreach (config('cvo.health_outcomes', []) as $outcome) {
            $byOutcome[$outcome] = (clone $health)->where('outcome', $outcome)->count();
        }

        return [
            'health_records' => (clone $health)->count(),
            'open_cases' => (clone $health)
                ->where(fn ($q) => $q->whereNull('outcome')->orWhereIn('outcome', $openOutcomes))
                ->count(),
            'by_outcome' => $byOutcome,
            'case_notes' => CaseNote::query()
                ->whereHas('beneficiary', $this->barangayFilter($barangay))->count(),
            'vaccinations' => MonitoringRecord::query()
                ->whereHas('beneficiary', $this->barangayFilter($barangay))
                ->whereNotNull('vaccination_date')->count(),
        ];
    }

    /**
     * The per-barangay table the rest of the page sums to. One grouped query;
     * a barangay with households but no visits still appears, with zeros.
     *
     * @return list<array<string, mixed>>
     */
    private function perBarangaySection(): array
    {
        return Beneficiary::query()
            ->selectRaw('address as barangay, count(*) as households')
            ->selectRaw('(select count(*) from monitoring_records mr join beneficiaries b2 on b2.id = mr.beneficiary_id where b2.address = beneficiaries.address) as monitoring_visits')
            ->selectRaw('(select count(*) from field_visits fv join beneficiaries b3 on b3.id = fv.beneficiary_id where b3.address = beneficiaries.address) as field_visits')
            ->selectRaw('(select count(*) from health_records hr join beneficiaries b4 on b4.id = hr.beneficiary_id where b4.address = beneficiaries.address) as health_records')
            ->selectRaw('(select count(*) from dispersal_events de join beneficiaries b5 on b5.id = de.beneficiary_id where b5.address = beneficiaries.address) as dispersals')
            ->groupBy('address')
            ->orderBy('address')
            ->get()
            ->map(fn ($row): array => [
                'barangay' => $row->barangay,
                'households' => (int) $row->households,
                'monitoring_visits' => (int) $row->monitoring_visits,
                'field_visits' => (int) $row->field_visits,
                'health_records' => (int) $row->health_records,
                'dispersals' => (int) $row->dispersals,
            ])
            ->all();
    }

    /**
     * Dispersals per month over the trailing window, oldest month first.
     * Months with no dispersals appear with zero so the trend reads as a
     * trend rather than a list of busy months.
     *
     * @return list<array{month: string, label: string, dispersals: int, re_dispersals: int}>
     */
    private function trendSection(?string $barangay): array
    {
        $months = [];

        for ($i = self::TREND_MONTHS - 1; $i >= 0; $i--) {
            $start = Carbon::now()->startOfMonth()->subMonths($i);
            $months[$start->format('Y-m')] = [
                'month' => $start->format('Y-m'),
                'label' => $start->format('M Y'),
                'dispersals' => 0,
                're_dispersals' => 0,
            ];
        }

        $rows = DispersalEvent::query()
            ->whereHas('beneficiary', $this->barangayFilter($barangay))
            ->where('date_dispersed', '>=', Carbon::now()->startOfMonth()->subMonths(self::TREND_MONTHS - 1)->toDateString())
            ->get(['dispersal_type', 'date_dispersed']);

        foreach ($rows as $row) {
            $key = $row->date_dispersed?->format('Y-m');

            if ($key === null || ! isset($months[$key])) {
                continue;
            }

            $months[$key]['dispersals']++;
            if ($row->dispersal_type === DispersalEvent::TYPE_RE_DISPERSAL) {
                $months[$key]['re_dispersals']++;
            }
        }

        return array_values($months);
    }

    /**
     * A whereHas closure narrowing to one barangay, or nothing for the whole
     * city — one helper so the barangay rule exists once.
     */
    private function barangayFilter(?string $barangay): \Closure
    {
        return fn ($q) => $barangay ? $q->where('address', $barangay) : null;
    }
}
