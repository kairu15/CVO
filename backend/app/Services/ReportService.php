<?php

namespace App\Services;

use App\Models\Animal;
use App\Models\AnimalOwnershipEvent;
use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\FieldVisit;
use App\Models\HealthRecord;
use App\Models\MonitoringRecord;
use App\Models\User;
use App\Support\Barangays;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;

/**
 * City-wide program reporting — one aggregated read over the tables that
 * already exist.
 *
 * Like every derived screen in this system there is no report table and
 * nothing to encode: the counts restate Beneficiary, MonitoringRecord,
 * AnimalOwnershipEvent, FieldVisit, HealthRecord and CaseNote rows. The admin
 * dashboard already offers the monitoring workbook import/export; this is the
 * complement — a single page answering "how big is the program, how active is
 * it, and where does it need attention" without exporting anything.
 *
 * Dispersals are read from `animal_ownership_events`, the SAME append-only
 * source the Dispersal map and Barangay dispersal analytics use. The older
 * beneficiary-centric `dispersal_events` table remains for genealogy and
 * pass-on history, but it is no longer the report's delivery count: counting
 * it made the report show zero on databases where the newer ownership module
 * is the active one.
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

    /** Event types that put an animal into a household. */
    private const PLACEMENT_TYPES = [
        AnimalOwnershipEvent::TYPE_DISPERSAL,
        AnimalOwnershipEvent::TYPE_RE_DISPERSAL,
        AnimalOwnershipEvent::TYPE_PASS_ON,
    ];

    public function __construct(private readonly BeneficiaryService $beneficiaries) {}

    /**
     * The full city-wide report, optionally narrowed by barangay, dispersal
     * dates, animal category and specific animal type.
     *
     * @return array<string, mixed>
     */
    public function cityWide(
        User $viewer,
        ?string $barangay = null,
        ?Carbon $from = null,
        ?Carbon $to = null,
        ?string $category = null,
        ?string $animalType = null,
        ?string $beneficiary = null,
        ?string $dispersalType = null,
    ): array {
        // Admin sees the whole program; the scoping service is reused anyway
        // so the report's numbers can never exceed the viewer's real scope.
        $beneficiaries = $this->beneficiaries->scopeQueryFor($viewer);

        if ($barangay !== null && $barangay !== '') {
            $beneficiaries->where('address', $barangay);
        }

        $this->filterBeneficiaries($beneficiaries, $category, $animalType);
        $this->filterBeneficiaryTerm($beneficiaries, $beneficiary);

        $base = clone $beneficiaries;

        $dispersals = $this->dispersalSection(
            $barangay,
            $from,
            $to,
            $category,
            $animalType,
            $beneficiary,
            $dispersalType,
        );

        return [
            'scope' => [
                'barangay' => $barangay,
                'barangays' => Barangays::all(),
                'from' => $from?->toDateString(),
                'to' => $to?->toDateString(),
                'category' => $category,
                'animal_type' => $animalType,
                'beneficiary' => $beneficiary,
                'dispersal_type' => $dispersalType,
            ],
            'program' => $this->programSection($base, $category, $animalType),
            'dispersals' => $dispersals,
            'activity' => $this->activitySection($barangay, $dispersals, $beneficiary),
            'clinical' => $this->clinicalSection($barangay, $category, $animalType, $beneficiary),
            'per_barangay' => $this->perBarangaySection(
                $barangay,
                $from,
                $to,
                $category,
                $animalType,
                $beneficiary,
                $dispersalType,
            ),
            'trend' => $this->trendSection($barangay, $category, $animalType, $beneficiary, $dispersalType),
        ];
    }

    /**
     * Program size: households, registered animals, and how much of it is
     * actively looked after (a technician assigned) versus unassigned.
     *
     * @param  Builder<Beneficiary>  $base
     * @return array<string, int>
     */
    private function programSection(Builder $base, ?string $category, ?string $animalType): array
    {
        $animals = Animal::query()
            ->whereIn('current_owner_id', (clone $base)->select('id'));

        if ($category !== null && $category !== '') {
            $animals->whereHas('animalType', fn (Builder $q) => $q->where('main_category', $category));
        }

        if ($animalType !== null && $animalType !== '') {
            $animals->where(function (Builder $q) use ($animalType): void {
                $q->where('animal_type', $animalType)
                    ->orWhereHas('animalType', fn (Builder $type) => $type->where('name', $animalType));
            });
        }

        $cutoff = now()->subDays(BeneficiaryDirectoryService::OVERDUE_DAYS)->toDateString();

        // "Pending follow-up" is a household that either has no technician or
        // has had no dated monitoring/field contact inside the shared window.
        // It is a worklist, not a dispersal status: every dispersal event is
        // already a completed record.
        $pending = (clone $base)
            ->where(function (Builder $q) use ($cutoff): void {
                $q->whereNull('technician_id')
                    ->orWhere(function (Builder $assigned) use ($cutoff): void {
                        $assigned->whereNotNull('technician_id')
                            ->whereDoesntHave(
                                'monitoringRecords',
                                fn (Builder $m) => $m->whereNotNull('date_monitored')
                                    ->where('date_monitored', '>=', $cutoff),
                            )
                            ->whereDoesntHave(
                                'fieldVisits',
                                fn (Builder $v) => $v->where('visited_on', '>=', $cutoff),
                            );
                    });
            })
            ->count();

        return [
            'households' => (clone $base)->count(),
            'animals' => $animals->count(),
            'with_technician' => (clone $base)->whereNotNull('technician_id')->count(),
            'unassigned' => (clone $base)->whereNull('technician_id')->count(),
            'pending_follow_up' => $pending,
            'follow_up_days' => BeneficiaryDirectoryService::OVERDUE_DAYS,
        ];
    }

    /**
     * The active delivery log, split by the animal master list's main
     * category and by handover type. Returns are counted separately because
     * they take an animal OUT of a household.
     *
     * @return array<string, int>
     */
    private function dispersalSection(
        ?string $barangay,
        ?Carbon $from,
        ?Carbon $to,
        ?string $category,
        ?string $animalType,
        ?string $beneficiary,
        ?string $dispersalType,
    ): array {
        $query = AnimalOwnershipEvent::query()
            ->where('status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->whereIn('event_type', self::PLACEMENT_TYPES);

        $this->filterEvents(
            $query,
            $barangay,
            $from,
            $to,
            $category,
            $animalType,
            $beneficiary,
            $dispersalType,
        );

        $total = (clone $query)->count();
        $livestock = (clone $query)
            ->whereHas('animal.animalType', fn (Builder $q) => $q->where('main_category', 'livestock'))
            ->count();
        $poultry = (clone $query)
            ->whereHas('animal.animalType', fn (Builder $q) => $q->where('main_category', 'poultry'))
            ->count();
        $other = (clone $query)
            ->whereHas('animal.animalType', fn (Builder $q) => $q->where('main_category', 'other'))
            ->count();

        $returns = AnimalOwnershipEvent::query()
            ->where('status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->where('event_type', AnimalOwnershipEvent::TYPE_RETURN)
            ->when($barangay !== null && $barangay !== '', fn (Builder $q) => $q->whereHas(
                'fromBeneficiary',
                fn (Builder $b) => $b->where('address', $barangay),
            ))
            ->when($from !== null, fn (Builder $q) => $q->where('event_date', '>=', $from->toDateString()))
            ->when($to !== null, fn (Builder $q) => $q->where('event_date', '<=', $to->toDateString()))
            ->when($category !== null && $category !== '', fn (Builder $q) => $q->whereHas(
                'animal.animalType',
                fn (Builder $type) => $type->where('main_category', $category),
            ))
            ->when($animalType !== null && $animalType !== '', fn (Builder $q) => $q->whereHas(
                'animal',
                fn (Builder $animal) => $animal->where(function (Builder $a) use ($animalType): void {
                    $a->where('animal_type', $animalType)
                        ->orWhereHas('animalType', fn (Builder $type) => $type->where('name', $animalType));
                }),
            ))
            ->when($beneficiary !== null && $beneficiary !== '', fn (Builder $q) => $q->whereHas(
                'fromBeneficiary',
                fn (Builder $b) => $this->filterBeneficiaryTerm($b, $beneficiary),
            ))
            ->when($dispersalType !== null && $dispersalType !== '', fn (Builder $q) => $q->where('event_type', $dispersalType))
            ->count();

        return [
            'total' => $total,
            'livestock' => $livestock,
            'poultry' => $poultry,
            'other' => $other,
            'unclassified' => max(0, $total - $livestock - $poultry - $other),
            'initial' => (clone $query)->where('event_type', AnimalOwnershipEvent::TYPE_DISPERSAL)->count(),
            're_dispersals' => (clone $query)->where('event_type', AnimalOwnershipEvent::TYPE_RE_DISPERSAL)->count(),
            'pass_ons' => (clone $query)->where('event_type', AnimalOwnershipEvent::TYPE_PASS_ON)->count(),
            'returns' => $returns,
        ];
    }

    /**
     * Field activity: the two visit logs and the canonical dispersal counts.
     *
     * @param  array<string, int>  $dispersals
     * @return array<string, int>
     */
    private function activitySection(?string $barangay, array $dispersals, ?string $beneficiary = null): array
    {
        $monitoring = MonitoringRecord::query()
            ->whereHas('beneficiary', function (Builder $q) use ($barangay, $beneficiary): void {
                $this->barangayFilter($barangay)($q);
                $this->filterBeneficiaryTerm($q, $beneficiary);
            });

        $visits = FieldVisit::query()
            ->whereHas('beneficiary', function (Builder $q) use ($barangay, $beneficiary): void {
                $this->barangayFilter($barangay)($q);
                $this->filterBeneficiaryTerm($q, $beneficiary);
            });

        return [
            'monitoring_visits' => (clone $monitoring)->count(),
            'field_visits' => (clone $visits)->count(),
            'field_visits_with_location' => (clone $visits)
                ->whereNotNull('latitude')->whereNotNull('longitude')->count(),
            'dispersals' => $dispersals['total'],
            're_dispersals' => $dispersals['re_dispersals'],
        ];
    }

    /**
     * Clinical load: the outcome vocabulary from SettingsService (the same
     * editable list the health record form offers), so the report cannot name
     * an outcome the system does not use.
     *
     * @return array<string, mixed>
     */
    private function clinicalSection(
        ?string $barangay,
        ?string $category,
        ?string $animalType,
        ?string $beneficiary = null,
    ): array {
        $health = HealthRecord::query()
            ->whereHas('beneficiary', function (Builder $q) use ($barangay, $category, $animalType, $beneficiary): void {
                $this->barangayFilter($barangay)($q);
                $this->filterBeneficiaries($q, $category, $animalType);
                $this->filterBeneficiaryTerm($q, $beneficiary);
            });

        $byOutcome = [];
        $outcomes = app(SettingsService::class)->healthOutcomes();
        $openOutcomes = app(SettingsService::class)->openHealthOutcomes();

        foreach ($outcomes as $outcome) {
            $byOutcome[$outcome] = (clone $health)->where('outcome', $outcome)->count();
        }

        $caseNotes = CaseNote::query()
            ->whereHas('beneficiary', function (Builder $q) use ($barangay, $category, $animalType, $beneficiary): void {
                $this->barangayFilter($barangay)($q);
                $this->filterBeneficiaries($q, $category, $animalType);
                $this->filterBeneficiaryTerm($q, $beneficiary);
            });

        return [
            'health_records' => (clone $health)->count(),
            'open_cases' => (clone $health)
                ->where(fn ($q) => $q->whereNull('outcome')->orWhereIn('outcome', $openOutcomes))
                ->count(),
            'by_outcome' => $byOutcome,
            'case_notes' => $caseNotes->count(),
            'vaccinations' => MonitoringRecord::query()
                ->whereHas('beneficiary', function (Builder $q) use ($barangay, $category, $animalType, $beneficiary): void {
                    $this->barangayFilter($barangay)($q);
                    $this->filterBeneficiaries($q, $category, $animalType);
                    $this->filterBeneficiaryTerm($q, $beneficiary);
                })
                ->whereNotNull('vaccination_date')->count(),
        ];
    }

    /**
     * The per-barangay comparison table the rest of the page sums to. One
     * grouped household query plus one grouped ownership-event query; a
     * barangay with households but no visits still appears, with zeros.
     *
     * @return list<array<string, mixed>>
     */
    private function perBarangaySection(
        ?string $barangay,
        ?Carbon $from,
        ?Carbon $to,
        ?string $category,
        ?string $animalType,
        ?string $beneficiary,
        ?string $dispersalType,
    ): array {
        $eventRows = AnimalOwnershipEvent::query()
            ->join('barangays as event_barangays', 'event_barangays.id', '=', 'animal_ownership_events.to_barangay_id')
            ->join('animals as event_animals', 'event_animals.id', '=', 'animal_ownership_events.animal_id')
            ->leftJoin('animal_types as event_types', 'event_types.id', '=', 'event_animals.animal_type_id')
            ->where('animal_ownership_events.status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->whereIn('animal_ownership_events.event_type', self::PLACEMENT_TYPES)
            ->whereNull('event_animals.deleted_at')
            ->when($from !== null, fn (Builder $q) => $q->where('animal_ownership_events.event_date', '>=', $from->toDateString()))
            ->when($to !== null, fn (Builder $q) => $q->where('animal_ownership_events.event_date', '<=', $to->toDateString()))
            ->when($category !== null && $category !== '', fn (Builder $q) => $q->where('event_types.main_category', $category))
            ->when($animalType !== null && $animalType !== '', fn (Builder $q) => $q->where(
                fn (Builder $value) => $value->where('event_types.name', $animalType)
                    ->orWhere('event_animals.animal_type', $animalType),
            ))
            ->when($beneficiary !== null && $beneficiary !== '', fn (Builder $q) => $q->whereHas(
                'toBeneficiary',
                fn (Builder $b) => $this->filterBeneficiaryTerm($b, $beneficiary),
            ))
            ->when($dispersalType !== null && $dispersalType !== '', fn (Builder $q) => $q->where(
                'animal_ownership_events.event_type',
                $dispersalType,
            ))
            ->selectRaw('event_barangays.name as barangay')
            ->selectRaw('count(*) as dispersals')
            ->selectRaw('coalesce(sum(case when event_types.main_category = ? then 1 else 0 end), 0) as livestock', ['livestock'])
            ->selectRaw('coalesce(sum(case when event_types.main_category = ? then 1 else 0 end), 0) as poultry', ['poultry'])
            ->selectRaw('coalesce(sum(case when event_types.main_category = ? then 1 else 0 end), 0) as other', ['other'])
            ->groupBy('event_barangays.name')
            ->get()
            ->keyBy('barangay');

        $households = Beneficiary::query()
            ->when($barangay !== null && $barangay !== '', fn (Builder $q) => $q->where('address', $barangay))
            ->when($category !== null && $category !== '', fn (Builder $q) => $this->filterBeneficiaries($q, $category, null))
            ->when($animalType !== null && $animalType !== '', fn (Builder $q) => $this->filterBeneficiaries($q, null, $animalType))
            ->when($beneficiary !== null && $beneficiary !== '', fn (Builder $q) => $this->filterBeneficiaryTerm($q, $beneficiary));

        // The activity columns follow the same household scope as the row.
        // Grouping them separately keeps the SoftDeletes scope in force and
        // avoids the old correlated counts, which ignored every filter except
        // the barangay address.
        $monitoring = MonitoringRecord::query()
            ->join('beneficiaries as activity_beneficiaries', 'activity_beneficiaries.id', '=', 'monitoring_records.beneficiary_id')
            ->whereIn('monitoring_records.beneficiary_id', (clone $households)->select('id'))
            ->whereNull('monitoring_records.deleted_at')
            ->selectRaw('activity_beneficiaries.address as barangay, count(*) as total')
            ->groupBy('activity_beneficiaries.address')
            ->pluck('total', 'barangay');

        $visits = FieldVisit::query()
            ->join('beneficiaries as activity_beneficiaries', 'activity_beneficiaries.id', '=', 'field_visits.beneficiary_id')
            ->whereIn('field_visits.beneficiary_id', (clone $households)->select('id'))
            ->whereNull('field_visits.deleted_at')
            ->selectRaw('activity_beneficiaries.address as barangay, count(*) as total')
            ->groupBy('activity_beneficiaries.address')
            ->pluck('total', 'barangay');

        $health = HealthRecord::query()
            ->join('beneficiaries as activity_beneficiaries', 'activity_beneficiaries.id', '=', 'health_records.beneficiary_id')
            ->whereIn('health_records.beneficiary_id', (clone $households)->select('id'))
            ->whereNull('health_records.deleted_at')
            ->selectRaw('activity_beneficiaries.address as barangay, count(*) as total')
            ->groupBy('activity_beneficiaries.address')
            ->pluck('total', 'barangay');

        return $households
            ->selectRaw('address as barangay, count(*) as households')
            ->groupBy('address')
            ->orderBy('address')
            ->get()
            ->map(function ($row) use ($eventRows, $monitoring, $visits, $health): array {
                $events = $eventRows->get($row->barangay);
                $total = (int) ($events->dispersals ?? 0);
                $livestock = (int) ($events->livestock ?? 0);
                $poultry = (int) ($events->poultry ?? 0);
                $other = (int) ($events->other ?? 0);

                return [
                    'barangay' => $row->barangay,
                    'households' => (int) $row->households,
                    'monitoring_visits' => (int) ($monitoring->get($row->barangay) ?? 0),
                    'field_visits' => (int) ($visits->get($row->barangay) ?? 0),
                    'health_records' => (int) ($health->get($row->barangay) ?? 0),
                    'dispersals' => $total,
                    'livestock' => $livestock,
                    'poultry' => $poultry,
                    'other' => $other,
                    'unclassified' => max(0, $total - $livestock - $poultry - $other),
                ];
            })
            ->all();
    }

    /**
     * Dispersals per month over the trailing window, oldest month first.
     * Months with no dispersals appear with zero so the trend reads as a
     * trend rather than a list of busy months.
     *
     * @return list<array{month: string, label: string, dispersals: int, re_dispersals: int}>
     */
    private function trendSection(
        ?string $barangay,
        ?string $category,
        ?string $animalType,
        ?string $beneficiary = null,
        ?string $dispersalType = null,
    ): array
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

        $query = AnimalOwnershipEvent::query()
            ->where('status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->whereIn('event_type', self::PLACEMENT_TYPES)
            ->where('event_date', '>=', Carbon::now()->startOfMonth()->subMonths(self::TREND_MONTHS - 1)->toDateString());

        $this->filterEvents($query, $barangay, null, null, $category, $animalType, $beneficiary, $dispersalType);

        $rows = $query->get(['event_type', 'event_date']);

        foreach ($rows as $row) {
            $key = $row->event_date?->format('Y-m');

            if ($key === null || ! isset($months[$key])) {
                continue;
            }

            $months[$key]['dispersals']++;
            if ($row->event_type === AnimalOwnershipEvent::TYPE_RE_DISPERSAL) {
                $months[$key]['re_dispersals']++;
            }
        }

        return array_values($months);
    }

    /**
     * The category/type filters expressed against a beneficiary query.
     *
     * @param  Builder<Beneficiary>  $query
     */
    private function filterBeneficiaries(Builder $query, ?string $category, ?string $animalType): void
    {
        if ($category !== null && $category !== '') {
            $query->whereHas('animalType', fn (Builder $q) => $q->where('main_category', $category));
        }

        if ($animalType !== null && $animalType !== '') {
            $query->where(function (Builder $q) use ($animalType): void {
                $q->where('animal_type', $animalType)
                    ->orWhereHas('animalType', fn (Builder $type) => $type->where('name', $animalType));
            });
        }
    }

    /**
     * Apply the report's event-level filters in one place.
     *
     * @param  Builder<AnimalOwnershipEvent>  $query
     */
    private function filterEvents(
        Builder $query,
        ?string $barangay,
        ?Carbon $from,
        ?Carbon $to,
        ?string $category,
        ?string $animalType,
        ?string $beneficiary = null,
        ?string $dispersalType = null,
    ): void {
        $query
            ->when($barangay !== null && $barangay !== '', fn (Builder $q) => $q->whereHas(
                'toBeneficiary',
                fn (Builder $b) => $b->where('address', $barangay),
            ))
            ->when($from !== null, fn (Builder $q) => $q->where('event_date', '>=', $from->toDateString()))
            ->when($to !== null, fn (Builder $q) => $q->where('event_date', '<=', $to->toDateString()))
            ->when($category !== null && $category !== '', fn (Builder $q) => $q->whereHas(
                'animal.animalType',
                fn (Builder $type) => $type->where('main_category', $category),
            ))
            ->when($animalType !== null && $animalType !== '', fn (Builder $q) => $q->whereHas(
                'animal',
                fn (Builder $animal) => $animal->where(function (Builder $a) use ($animalType): void {
                    $a->where('animal_type', $animalType)
                        ->orWhereHas('animalType', fn (Builder $type) => $type->where('name', $animalType));
                }),
            ))
            ->when($beneficiary !== null && $beneficiary !== '', fn (Builder $q) => $q->whereHas(
                'toBeneficiary',
                fn (Builder $b) => $this->filterBeneficiaryTerm($b, $beneficiary),
            ))
            ->when($dispersalType !== null && $dispersalType !== '', fn (Builder $q) => $q->where('event_type', $dispersalType));
    }

    /**
     * Narrow a beneficiary query to a name / RSBSA / ear-tag search term.
     *
     * @param  Builder<Beneficiary>  $query
     */
    private function filterBeneficiaryTerm(Builder $query, ?string $beneficiary): void
    {
        if ($beneficiary === null || $beneficiary === '') {
            return;
        }

        $like = '%'.$beneficiary.'%';

        $query->where(function (Builder $q) use ($like): void {
            $q->where('name_of_farmer', 'like', $like)
                ->orWhere('rsbsa_number', 'like', $like)
                ->orWhere('ear_tag_number', 'like', $like);
        });
    }

    /**
     * A whereHas closure narrowing to one barangay, or nothing for the whole
     * city — one helper so the barangay rule exists once.
     */
    private function barangayFilter(?string $barangay): \Closure
    {
        return fn (Builder $q) => $barangay ? $q->where('address', $barangay) : null;
    }
}
