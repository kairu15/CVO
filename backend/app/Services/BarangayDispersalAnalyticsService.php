<?php

namespace App\Services;

use App\Models\AnimalOwnershipEvent;
use App\Models\AnimalType;
use App\Models\Barangay;
use App\Models\User;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Barangay-level dispersal and re-dispersal analytics — the numbers behind
 * the Reports "Barangay dispersal" tab, computed in SQL (a handful of
 * aggregate queries per answer; no raw rows shipped for the client to count).
 *
 * DEFINITIONS (stated here because the office may tune them later):
 *
 *   dispersed        active `dispersal` events delivered INTO the barangay
 *                    (CVO → household).
 *   re-dispersed out active `re_dispersal` OR `pass_on` events whose SOURCE
 *                    household was in the barangay. Both event types are the
 *                    same movement in the programme's vocabulary — a
 *                    household handing an animal on — and the legacy
 *                    re-dispersal records were migrated to `pass_on`, so
 *                    counting only one would hide the other half of history.
 *   re-dispersed in  the same events, counted for the DESTINATION barangay.
 *   within barangay  the same events whose source and destination are the
 *                    SAME barangay. They count in `in` and `out` (and cancel
 *                    in the net flow) but never become flow LINES.
 *   net flow         re-dispersed in − re-dispersed out.
 *   re-dispersal
 *   rate             DISTINCT animals re-dispersed out of the barangay ÷
 *                    DISTINCT animals dispersed into it, both counted from
 *                    the beginning of records UP TO the end of the selected
 *                    period (not restricted to the period start). Distinct
 *                    animals, so an animal re-dispersed several times cannot
 *                    push the rate past 100%. Null when the barangay has
 *                    fewer distinct dispersed animals than the configured
 *                    minimum — a small denominator makes a rate lie
 *                    (1 of 1 = 100%).
 *
 *   `return` events are never counted: handing an animal back to CVO is not
 *   a dispersal to a barangay (and has no destination barangay at all).
 *
 * SCOPING: admin and doctor see city-wide numbers; a technician sees the
 * same views restricted to events touching a household assigned to them —
 * enforced here in the query layer, never in the client.
 *
 * SNAPSHOTS: every event carries from/to BARANGAY ids written at handover
 * time, so editing a beneficiary's barangay afterwards cannot rewrite
 * history. A barangay with no matching events still appears (zeros) — the
 * "lowest" list must include the barangays where nothing happened.
 */
class BarangayDispersalAnalyticsService
{
    /** Event types that count as a re-dispersal (household → household). */
    private const RE_DISPERSAL_TYPES = [
        AnimalOwnershipEvent::TYPE_RE_DISPERSAL,
        AnimalOwnershipEvent::TYPE_PASS_ON,
    ];

    /** Every event type the analytics can consider. */
    public const FILTERABLE_EVENT_TYPES = [
        AnimalOwnershipEvent::TYPE_DISPERSAL,
        AnimalOwnershipEvent::TYPE_RE_DISPERSAL,
        AnimalOwnershipEvent::TYPE_PASS_ON,
    ];

    /** The metrics the tab's switch offers, with their row keys and labels. */
    public const METRICS = [
        'dispersed' => ['key' => 'dispersed', 'label' => 'dispersals', 'kind' => 'count'],
        'redispersed_out' => ['key' => 'redispersed_out', 'label' => 're-dispersals out', 'kind' => 'count'],
        'redispersed_in' => ['key' => 'redispersed_in', 'label' => 're-dispersals in', 'kind' => 'count'],
        'net_flow' => ['key' => 'net_flow', 'label' => 'net flow', 'kind' => 'net'],
        'redispersal_rate' => ['key' => 'redispersal_rate', 'label' => 're-dispersal rate', 'kind' => 'rate'],
    ];

    /** How long an aggregate answer is reused (same policy as the report charts). */
    private const CACHE_SECONDS = 60;

    public function __construct(private readonly SettingsService $settings) {}

    /**
     * One row per barangay (zeros included) + the highest/lowest summary for
     * every metric, ties included, and one generated sentence per metric.
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>, per_1000: bool}  $filters
     * @return array<string, mixed>
     */
    public function barangaySummary(User $viewer, array $filters): array
    {
        $minRateAnimals = $this->settings->analyticsMinRateAnimals();

        // Plain arrays only in the cache: a cached Collection (or model)
        // depends on unserialize() finding the class loaded, which a warm
        // cache across deploys cannot promise.
        [$rows, $cumulative] = Cache::remember(
            $this->cacheKey('summary', $viewer, $filters, $minRateAnimals),
            self::CACHE_SECONDS,
            function () use ($viewer, $filters): array {
                // Scalar arrays only: the cache deliberately unserializes with
                // no classes allowed (config/cache.php serializable_classes =>
                // false, gadget-chain hardening), so any object in a cached
                // payload — even stdClass — comes back unreadable.
                $rows = collect($this->aggregateRows($viewer, $filters))
                    ->map(fn (object $row): array => (array) $row)
                    ->all();

                // The rate's denominator is the barangay's whole dispersal
                // history up to the period END, so it is computed separately
                // from the windowed aggregate — two grouped queries for all
                // barangays, not two per barangay.
                $cumulative = [
                    'dispersed' => $this->cumulativeDistinctByBarangay($viewer, $filters, 'dispersed'),
                    'out' => $this->cumulativeDistinctByBarangay($viewer, $filters, 'out'),
                ];

                return [$rows, $cumulative];
            },
        );

        $barangays = collect($rows)
            ->map(fn (array $row): array => $this->rowPayload($row, $cumulative, $minRateAnimals))
            ->all();

        return [
            'barangays' => $barangays,
            'summary' => $this->summary($barangays, $viewer, $filters, $minRateAnimals),
            'min_rate_animals' => $minRateAnimals,
            'filters' => $this->filterEcho($filters),
            'scoped' => $this->isScoped($viewer),
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /**
     * Barangay → barangay re-dispersal flows, one row per ordered pair with a
     * non-zero count. Same-barangay pairs ride along (they belong on the
     * matrix's diagonal); the map draws lines only across barangays.
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>}  $filters
     * @return array<string, mixed>
     */
    public function flows(User $viewer, array $filters, bool $includeCvo): array
    {
        return Cache::remember(
            $this->cacheKey('flows', $viewer, [...$filters, 'include_cvo' => $includeCvo], 0),
            self::CACHE_SECONDS,
            function () use ($viewer, $filters, $includeCvo): array {
                $names = Barangay::query()->orderBy('id')->pluck('name', 'id');

                // The event-type filter applies here too: flows come from the
                // re-dispersal types the filter still allows, and the CVO
                // source rows from the dispersal type.
                $reTypes = array_values(array_intersect(self::RE_DISPERSAL_TYPES, $filters['event_types']));
                $cvoWanted = $includeCvo
                    && in_array(AnimalOwnershipEvent::TYPE_DISPERSAL, $filters['event_types'], true);

                $flows = $reTypes === []
                    ? collect()
                    : $this->baseQuery($viewer, $filters, $reTypes)
                        ->whereNotNull('e.from_barangay_id')
                        ->whereNotNull('e.to_barangay_id')
                        ->groupBy('e.from_barangay_id', 'e.to_barangay_id')
                        ->selectRaw('e.from_barangay_id as origin_barangay_id, e.to_barangay_id as destination_barangay_id, count(*) as total')
                        ->get();

                if ($cvoWanted) {
                    // "Include CVO as a source": the initial dispersals become
                    // CVO → barangay rows. They are a toggle, not a default —
                    // the CVO is in every dispersal's history, so on by
                    // default the option would dwarf the barangay-to-barangay
                    // handovers the tab is about.
                    $cvo = $this->baseQuery($viewer, $filters, [AnimalOwnershipEvent::TYPE_DISPERSAL])                        ->whereNotNull('e.to_barangay_id')
                        ->groupBy('e.to_barangay_id')
                        ->selectRaw('null as origin_barangay_id, e.to_barangay_id as destination_barangay_id, count(*) as total')
                        ->get();

                    $flows = $flows->concat($cvo)->sortByDesc('total')->values();
                }

                return [
                    'flows' => $flows->map(fn (object $row): array => [
                        // origin_barangay_id null = the CVO office.
                        'origin_barangay_id' => $row->origin_barangay_id !== null ? (int) $row->origin_barangay_id : null,
                        'destination_barangay_id' => (int) $row->destination_barangay_id,
                        'origin_name' => $row->origin_barangay_id !== null
                            ? $names->get($row->origin_barangay_id)
                            : 'CVO',
                        'destination_name' => $names->get($row->destination_barangay_id),
                        'count' => (int) $row->total,
                        'within_barangay' => $row->origin_barangay_id !== null
                            && (int) $row->origin_barangay_id === (int) $row->destination_barangay_id,
                    ])->all(),
                    'filters' => $this->filterEcho($filters),
                    'scoped' => $this->isScoped($viewer),
                    'generated_at' => now()->toIso8601String(),
                ];
            },
        );
    }

    /**
     * One barangay's floating card: the SAME filtered row the table and map
     * use, the mix of animals it received, and the newest handovers in and
     * out of it.
     *
     * The card is opened by clicking a polygon, so it must never disagree
     * with the polygon's fill, the hover label or the barangay table: `totals`
     * is the row from barangaySummary() (same filters, same cache) rather than
     * a second, independently filtered derivation. Null when the barangay is
     * not one of the covered rows — the controller turns that into a 404.
     *
     * Every list below rides the same baseQuery(), so voided events stay out,
     * the filters apply, and a technician's row scope is enforced in SQL.
     * `limit` bounds the newest items per list (1..100); `total` still reports
     * the full match count so the card can say "showing N of M".
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>, per_1000: bool}  $filters
     * @return array<string, mixed>|null
     */
    public function barangayDetail(User $viewer, int $barangayId, array $filters, int $limit = 25): ?array
    {
        $summary = $this->barangaySummary($viewer, $filters);

        $totals = collect($summary['barangays'])
            ->first(fn (array $candidate): bool => (int) $candidate['barangay_id'] === $barangayId);

        if ($totals === null) {
            return null;
        }

        $limit = max(1, min(100, $limit));

        // What ARRIVED here: initial dispersals plus either flavour of
        // household-to-household handover. `return` events never count (they
        // leave the barangay programme entirely).
        $receivedTypes = array_values(array_intersect(
            [AnimalOwnershipEvent::TYPE_DISPERSAL, ...self::RE_DISPERSAL_TYPES],
            $filters['event_types'],
        ));

        // What LEFT here: only the re-dispersal shapes, so the event-type
        // filter can silence this half without touching the received half.
        $passedOnTypes = array_values(array_intersect(self::RE_DISPERSAL_TYPES, $filters['event_types']));

        return [
            'barangay' => [
                'id' => $barangayId,
                'name' => $totals['name'],
                'population' => $totals['population'],
            ],
            'totals' => $totals,
            'categories' => $this->receivedCategories($viewer, $filters, $barangayId, $receivedTypes),
            'received' => $this->handovers($viewer, $filters, $barangayId, $receivedTypes, 'to_barangay_id', $limit),
            'passed_on' => $this->handovers($viewer, $filters, $barangayId, $passedOnTypes, 'from_barangay_id', $limit),
            'scoped' => $summary['scoped'],
            'filters' => $summary['filters'],
            'limit' => $limit,
        ];
    }

    /**
     * The mix of animals one barangay RECEIVED, grouped by the master list's
     * main category (livestock / poultry / other) and then by type name.
     *
     * One grouped query with the joins it needs — no per-type round trips.
     * The join is a LEFT join so an imported animal whose master-list row was
     * deleted still shows under its stored display string rather than
     * vanishing from the totals.
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>}  $filters
     * @param  list<string>  $types
     * @return list<array{category: string, label: string, total: int, types: list<array{name: string, count: int}>}>
     */
    private function receivedCategories(User $viewer, array $filters, int $barangayId, array $types): array
    {
        if ($types === []) {
            return [];
        }

        $rows = $this->baseQuery($viewer, $filters, $types)
            ->where('e.to_barangay_id', $barangayId)
            ->leftJoin('animals as ca', 'ca.id', '=', 'e.animal_id')
            ->leftJoin('animal_types as ct', 'ct.id', '=', 'ca.animal_type_id')
            ->groupByRaw("coalesce(ct.main_category, 'other'), coalesce(ct.name, ca.animal_type, 'Unspecified')")
            ->orderByRaw("coalesce(ct.main_category, 'other')")
            ->orderByRaw("coalesce(ct.name, ca.animal_type, 'Unspecified')")
            ->selectRaw(implode(', ', [
                "coalesce(ct.main_category, 'other') as main_category",
                "coalesce(ct.name, ca.animal_type, 'Unspecified') as type_name",
                'count(*) as total',
            ]))
            ->get();

        $groups = [];

        foreach ($rows as $row) {
            $key = (string) $row->main_category;

            $groups[$key] ??= [
                'category' => $key,
                'label' => AnimalType::CATEGORY_LABELS[$key] ?? ucfirst($key),
                'total' => 0,
                'types' => [],
            ];

            $groups[$key]['total'] += (int) $row->total;
            $groups[$key]['types'][] = [
                'name' => (string) $row->type_name,
                'count' => (int) $row->total,
            ];
        }

        // Display order is the master list's: livestock, poultry, then the
        // rest — the same order the animal-type cascade offers.
        $order = array_flip(AnimalType::MAIN_CATEGORIES);

        usort($groups, fn (array $a, array $b): int => ($order[$a['category']] ?? PHP_INT_MAX)
            <=> ($order[$b['category']] ?? PHP_INT_MAX));

        return array_values($groups);
    }

    /**
     * The newest handovers on one side of a barangay: every event whose
     * `from_barangay_id` (passed on) or `to_barangay_id` (received) is this
     * barangay, newest first.
     *
     * Two queries per list — one COUNT for the true total, one page of rows
     * with every join the payload needs — so the card's "showing N of M" is
     * honest without loading M rows.
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>}  $filters
     * @param  list<string>  $types
     * @param  'from_barangay_id'|'to_barangay_id'  $column
     * @return array{total: int, items: list<array<string, mixed>>}
     */
    private function handovers(User $viewer, array $filters, int $barangayId, array $types, string $column, int $limit): array
    {
        if ($types === []) {
            return ['total' => 0, 'items' => []];
        }

        $query = $this->baseQuery($viewer, $filters, $types)
            ->where("e.{$column}", $barangayId);

        $total = (clone $query)->count();

        if ($total === 0) {
            return ['total' => 0, 'items' => []];
        }

        $rows = $query
            ->leftJoin('animals as ia', 'ia.id', '=', 'e.animal_id')
            ->leftJoin('animal_types as it', 'it.id', '=', 'ia.animal_type_id')
            ->leftJoin('animal_classifications as ic', 'ic.id', '=', 'ia.classification_id')
            ->leftJoin('beneficiaries as fb', 'fb.id', '=', 'e.from_beneficiary_id')
            ->leftJoin('beneficiaries as tb', 'tb.id', '=', 'e.to_beneficiary_id')
            // Barangay names come from the event's SNAPSHOT columns, not the
            // households' current barangay, so a household edited afterwards
            // cannot relabel history.
            ->leftJoin('barangays as fbg', 'fbg.id', '=', 'e.from_barangay_id')
            ->leftJoin('barangays as tbg', 'tbg.id', '=', 'e.to_barangay_id')
            ->orderByDesc('e.event_date')
            ->orderByDesc('e.id')
            ->limit($limit)
            ->selectRaw(implode(', ', [
                'e.id as event_id',
                'e.animal_id as animal_id',
                'e.event_type as event_type',
                'e.event_date as event_date',
                "coalesce(it.name, ia.animal_type, 'Unspecified') as animal_type",
                "coalesce(it.main_category, 'other') as category",
                'ic.name as classification',
                'ia.ear_tag_number as ear_tag_number',
                'e.from_beneficiary_id as from_beneficiary_id',
                'e.to_beneficiary_id as to_beneficiary_id',
                'fb.name_of_farmer as from_name',
                'tb.name_of_farmer as to_name',
                'fb.technician_id as from_technician_id',
                'tb.technician_id as to_technician_id',
                'fbg.name as from_barangay',
                'tbg.name as to_barangay',
            ]))
            ->get();

        return [
            'total' => (int) $total,
            'items' => $rows->map(fn (object $row): array => [
                'event_id' => (int) $row->event_id,
                'animal_id' => (int) $row->animal_id,
                'event_type' => (string) $row->event_type,
                'event_date' => Carbon::parse((string) $row->event_date, 'Asia/Manila')->toDateString(),
                'animal_type' => (string) $row->animal_type,
                'category' => (string) $row->category,
                'classification' => $row->classification !== null ? (string) $row->classification : null,
                'ear_tag_number' => $row->ear_tag_number !== null ? (string) $row->ear_tag_number : null,
                'from' => $this->household(
                    $row->from_beneficiary_id,
                    $row->from_name,
                    $row->from_barangay,
                    $row->from_technician_id,
                    $viewer,
                ),
                'to' => $this->household(
                    $row->to_beneficiary_id,
                    $row->to_name,
                    $row->to_barangay,
                    $row->to_technician_id,
                    $viewer,
                ),
            ])->all(),
        ];
    }

    /**
     * One side of a handover, as the card may show it.
     *
     * PRIVACY: admin and doctor see every household name. A technician sees a
     * name only for a household assigned to them; every other household is
     * replaced with "Beneficiary in {barangay}" (or "Beneficiary (location
     * hidden)" when even the barangay is unknown) and flagged `masked`. No
     * RSBSA number, phone number or coordinate ever leaves this method.
     *
     * A null beneficiary is the CVO office — the source of a first dispersal.
     *
     * @return array{name: string, barangay: ?string, masked: bool}
     */
    private function household(mixed $beneficiaryId, mixed $name, mixed $barangayName, mixed $technicianId, User $viewer): array
    {
        $barangay = $barangayName !== null && $barangayName !== '' ? (string) $barangayName : null;

        if ($beneficiaryId === null) {
            return ['name' => 'CVO', 'barangay' => null, 'masked' => false];
        }

        $visible = ! $this->isScoped($viewer) || (int) $technicianId === (int) $viewer->id;

        if ($visible) {
            return [
                'name' => $name !== null && $name !== '' ? (string) $name : 'Unknown household',
                'barangay' => $barangay,
                'masked' => false,
            ];
        }

        return [
            'name' => $barangay !== null
                ? "Beneficiary in {$barangay}"
                : 'Beneficiary (location hidden)',
            'barangay' => $barangay,
            'masked' => true,
        ];
    }

    /* ------------------------------------------------------------------ *
     |  Internals                                                          |
     * ------------------------------------------------------------------ */

    /**
     * The base event query every arm of the aggregate starts from: active
     * rows only, within the date window and type set, the animal filters, and
     * the technician's row scope. Voided events are excluded everywhere in
     * this feature.
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>}  $filters
     * @param  list<string>  $types
     */
    private function baseQuery(User $viewer, array $filters, array $types): Builder
    {
        $query = DB::table('animal_ownership_events as e')
            ->where('e.status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->whereIn('e.event_type', $types)
            // Full-day string bounds rather than whereDate: the column reads
            // as 'Y-m-d 00:00:00' on SQLite and 'Y-m-d' on MySQL, and a range
            // comparison against both shapes stays correct while keeping the
            // (event_type, event_date, …) index usable.
            ->when($filters['to'] !== null, fn (Builder $q) => $q->where('e.event_date', '<=', $filters['to']->toDateString().' 23:59:59'))
            ->when($filters['from'] !== null, fn (Builder $q) => $q->where('e.event_date', '>=', $filters['from']->toDateString().' 00:00:00'))
            ->when($filters['animal_type_id'] !== null || $filters['classification_id'] !== null, fn (Builder $q) => $q->whereExists(
                fn (Builder $animal) => $animal
                    ->selectRaw(1)
                    ->from('animals as a')
                    ->whereColumn('a.id', 'e.animal_id')
                    ->whereNull('a.deleted_at')
                    ->when($filters['animal_type_id'] !== null, fn (Builder $a) => $a->where('a.animal_type_id', $filters['animal_type_id']))
                    ->when($filters['classification_id'] !== null, fn (Builder $a) => $a->where('a.classification_id', $filters['classification_id'])),
            ));

        // Row scope: a technician's numbers only count events that touch a
        // household assigned to them. Admin and doctor are city-wide.
        if ($this->isScoped($viewer)) {
            $assigned = DB::table('beneficiaries')
                ->where('technician_id', $viewer->id)
                ->whereNull('deleted_at')
                ->select('id');

            $query->where(function (Builder $q) use ($assigned): void {
                $q->whereIn('e.from_beneficiary_id', $assigned)
                    ->orWhereIn('e.to_beneficiary_id', $assigned);
            });
        }

        return $query;
    }

    /**
     * The per-barangay aggregate: every event contributes up to two rows (its
     * source side and its destination side), tagged with which metric the side
     * counts toward, then grouped by barangay. Barangays are the driver table,
     * so a barangay with nothing on record still appears — with zeros —
     * instead of vanishing from the "lowest" ranking.
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>}  $filters
     */
    private function aggregateRows(User $viewer, array $filters): Collection
    {
        $dispersalWanted = in_array(AnimalOwnershipEvent::TYPE_DISPERSAL, $filters['event_types'], true);
        $reDispersalWanted = collect(self::RE_DISPERSAL_TYPES)
            ->contains(fn (string $type): bool => in_array($type, $filters['event_types'], true));

        $arms = collect();

        if ($dispersalWanted) {
            $arms->push(
                $this->baseQuery($viewer, $filters, [AnimalOwnershipEvent::TYPE_DISPERSAL])
                    ->whereNotNull('e.to_barangay_id')
                    ->selectRaw("e.to_barangay_id as barangay_id, 'dispersed' as kind, e.animal_id"),
            );
        }

        if ($reDispersalWanted) {
            $arms->push(
                $this->baseQuery($viewer, $filters, self::RE_DISPERSAL_TYPES)
                    ->whereNotNull('e.from_barangay_id')
                    ->selectRaw("e.from_barangay_id as barangay_id, 'out' as kind, e.animal_id"),
            );

            $arms->push(
                $this->baseQuery($viewer, $filters, self::RE_DISPERSAL_TYPES)
                    ->whereNotNull('e.to_barangay_id')
                    ->selectRaw("e.to_barangay_id as barangay_id, 'in' as kind, e.animal_id"),
            );

            // Same-barangay handovers land in `in` and `out` above AND get
            // their own counter here, so the tab can show them separately.
            $arms->push(
                $this->baseQuery($viewer, $filters, self::RE_DISPERSAL_TYPES)
                    ->whereNotNull('e.from_barangay_id')
                    ->whereColumn('e.from_barangay_id', 'e.to_barangay_id')
                    ->selectRaw("e.from_barangay_id as barangay_id, 'within' as kind, e.animal_id"),
            );
        }

        if ($arms->isEmpty()) {
            return collect();
        }

        $union = $arms->first();

        foreach ($arms->skip(1) as $arm) {
            $union = $union->unionAll($arm);
        }

        $aggregate = DB::query()
            ->fromSub($union, 'x')
            ->groupBy('x.barangay_id')
            ->selectRaw(implode(', ', [
                'x.barangay_id',
                "sum(case when x.kind = 'dispersed' then 1 else 0 end) as dispersed",
                "sum(case when x.kind = 'out' then 1 else 0 end) as redispersed_out",
                "sum(case when x.kind = 'in' then 1 else 0 end) as redispersed_in",
                "sum(case when x.kind = 'within' then 1 else 0 end) as within_barangay",
                "count(distinct case when x.kind = 'dispersed' then x.animal_id end) as distinct_dispersed",
                "count(distinct case when x.kind = 'out' then x.animal_id end) as distinct_redispersed_out",
            ]));

        return DB::table('barangays as b')
            ->leftJoinSub($aggregate, 'agg', 'agg.barangay_id', '=', 'b.id')
            ->orderBy('b.id')
            ->selectRaw(implode(', ', [
                'b.id',
                'b.name',
                'b.latitude',
                'b.longitude',
                'b.population',
                'coalesce(agg.dispersed, 0) as dispersed',
                'coalesce(agg.redispersed_out, 0) as redispersed_out',
                'coalesce(agg.redispersed_in, 0) as redispersed_in',
                'coalesce(agg.within_barangay, 0) as within_barangay',
                'coalesce(agg.distinct_dispersed, 0) as distinct_dispersed',
                'coalesce(agg.distinct_redispersed_out, 0) as distinct_redispersed_out',
            ]))
            ->get();
    }

    /**
     * One side of every barangay's cumulative-to-period-end distinct animal
     * count — the rate's numerators and denominators. Deliberately its own
     * grouped queries: the rate ignores the period START by definition, so it
     * cannot ride the windowed aggregate.
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>}  $filters
     * @return array<int, int> barangay_id => distinct animals
     */
    private function cumulativeDistinctByBarangay(User $viewer, array $filters, string $kind): array
    {
        $types = $kind === 'dispersed'
            ? [AnimalOwnershipEvent::TYPE_DISPERSAL]
            : self::RE_DISPERSAL_TYPES;

        if (! in_array($types[0], $filters['event_types'], true)) {
            return [];
        }

        $column = $kind === 'dispersed' ? 'to_barangay_id' : 'from_barangay_id';

        return $this->baseQuery($viewer, $filters, $types)
            ->whereNotNull($column)
            ->groupBy($column)
            ->selectRaw("{$column} as barangay_id, count(distinct e.animal_id) as animals")
            ->pluck('animals', 'barangay_id')
            ->map(fn ($count) => (int) $count)
            ->all();
    }

    /**
     * One cached aggregate row — already a plain array (see the cache note
     * above) — turned into the API payload.
     *
     * @param  array<string, mixed>  $row
     * @param  array{dispersed: array<int, int>, out: array<int, int>}  $cumulative
     * @return array<string, mixed>
     */
    private function rowPayload(array $row, array $cumulative, int $minRateAnimals): array
    {
        $barangayId = (int) $row['id'];
        $population = $row['population'] !== null ? (int) $row['population'] : null;
        $dispersed = (int) $row['dispersed'];
        $out = (int) $row['redispersed_out'];
        $in = (int) $row['redispersed_in'];

        $rateDenominator = $cumulative['dispersed'][$barangayId] ?? 0;
        $rateNumerator = $cumulative['out'][$barangayId] ?? 0;

        $eligible = $rateDenominator >= $minRateAnimals;
        $rate = $eligible ? round($rateNumerator / $rateDenominator, 4) : null;

        $perThousand = fn (int $value): ?float => $population !== null && $population > 0
            ? round($value / $population * 1000, 2)
            : null;

        return [
            'barangay_id' => $barangayId,
            'name' => $row['name'],
            'latitude' => (float) $row['latitude'],
            'longitude' => (float) $row['longitude'],
            'population' => $population,
            'dispersed' => $dispersed,
            'redispersed_out' => $out,
            'redispersed_in' => $in,
            'within_barangay' => (int) $row['within_barangay'],
            'net_flow' => $in - $out,
            'distinct_dispersed' => (int) $row['distinct_dispersed'],
            'distinct_redispersed_out' => (int) $row['distinct_redispersed_out'],
            'rate_denominator' => $rateDenominator,
            'redispersal_rate' => $rate,
            'rate_eligible' => $eligible,
            'dispersed_per_1000' => $perThousand($dispersed),
            'redispersed_out_per_1000' => $perThousand($out),
            'redispersed_in_per_1000' => $perThousand($in),
            'net_flow_per_1000' => $perThousand($in - $out),
        ];
    }

    /**
     * The highest and lowest barangays for every metric, ties included, plus
     * totals and one rule-based sentence per metric — computed HERE so the
     * client renders, never re-derives, the ranking.
     *
     * @param  list<array<string, mixed>>  $barangays
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>, per_1000: bool}  $filters
     * @return array<string, mixed>
     */
    private function summary(array $barangays, User $viewer, array $filters, int $minRateAnimals): array
    {
        $summary = [];

        foreach (self::METRICS as $metric => $config) {
            // The rate ranks only barangays whose denominator cleared the
            // configured minimum; every other metric ranks all 28 rows.
            $rankable = collect($barangays)->filter(
                fn (array $row): bool => $config['kind'] !== 'rate' || $row['rate_eligible'],
            );

            $extremes = $this->extremes($rankable, $config['key']);

            $summary[$metric] = [
                'kind' => $config['kind'],
                'label' => $config['label'],
                ...$extremes,
                'total' => $config['kind'] === 'rate'
                    ? $this->cityRate($viewer, $filters, $minRateAnimals)
                    : (int) collect($barangays)->sum($config['key']),
                'sentence' => $this->sentence($config, $extremes, $rankable, $barangays, $minRateAnimals),
            ];
        }

        return $summary;
    }

    /**
     * The tied groups at the top and the bottom of one ranking.
     *
     * @param  Collection<int, array<string, mixed>>  $rows
     * @return array{highest: list<array<string, mixed>>, lowest: list<array<string, mixed>>}
     */
    private function extremes(Collection $rows, string $key): array
    {
        if ($rows->isEmpty()) {
            return ['highest' => [], 'lowest' => []];
        }

        $entry = fn (array $row): array => [
            'barangay_id' => $row['barangay_id'],
            'name' => $row['name'],
            'value' => $row[$key],
        ];

        $group = fn (int|float $target): array => $rows
            ->filter(fn (array $row): bool => $row[$key] === $target)
            ->map($entry)
            ->values()
            ->all();

        return [
            'highest' => $group($rows->max($key)),
            'lowest' => $group($rows->min($key)),
        ];
    }

    /**
     * The city-wide re-dispersal rate for the rate metric's summary card:
     * distinct animals re-dispersed out of any barangay ÷ distinct animals
     * dispersed into any barangay, cumulative to the end of the period.
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>}  $filters
     */
    private function cityRate(User $viewer, array $filters, int $minRateAnimals): ?float
    {
        $denominator = $this->baseQuery($viewer, $filters, [AnimalOwnershipEvent::TYPE_DISPERSAL])
            ->whereNotNull('e.to_barangay_id')
            ->distinct()
            ->count('e.animal_id');

        if ($denominator < $minRateAnimals) {
            return null;
        }

        $numerator = $this->baseQuery($viewer, $filters, self::RE_DISPERSAL_TYPES)
            ->whereNotNull('e.from_barangay_id')
            ->distinct()
            ->count('e.animal_id');

        return round($numerator / $denominator, 4);
    }

    /**
     * The one rule-based sentence under the summary cards. Generated from the
     * numbers on the page — no AI service — so it can never disagree with
     * them.
     *
     * @param  array{highest: list<array<string, mixed>>, lowest: list<array<string, mixed>>}  $extremes
     * @param  Collection<int, array<string, mixed>>  $rankable
     * @param  list<array<string, mixed>>  $barangays
     */
    private function sentence(array $config, array $extremes, Collection $rankable, array $barangays, int $minRateAnimals): string
    {
        if ($rankable->isEmpty()) {
            return $config['kind'] === 'rate'
                ? sprintf(
                    'No barangay has reached %d dispersed animals yet, so no rate is ranked (n < %d).',
                    $minRateAnimals,
                    $minRateAnimals,
                )
                : sprintf('No %s were recorded in this period.', $config['label']);
        }

        $names = fn (array $entries): string => collect($entries)->pluck('name')->implode(' and ');

        $highest = collect($extremes['highest']);
        $lowest = collect($extremes['lowest']);
        $top = $highest->first();

        return match ($config['kind']) {
            'rate' => sprintf(
                '%s re-dispersed the largest share of the animals it received (%d%%). %s re-dispersed none%s Barangays under %d dispersed animals are not ranked (n < %d).',
                $names($extremes['highest']),
                $this->percent($top['value']),
                $names($extremes['lowest']),
                (float) $lowest->first()['value'] === 0.0 ? '.' : sprintf(', at %d%%.', $this->percent($lowest->first()['value'])),
                $minRateAnimals,
                $minRateAnimals,
            ),
            'net' => sprintf(
                '%s recorded the highest net inflow (%+d).%s',
                $names($extremes['highest']),
                (int) $top['value'],
                (float) $lowest->first()['value'] < 0
                    ? sprintf(' %s had the largest net outflow (%+d).', $names($extremes['lowest']), (int) $lowest->first()['value'])
                    : '',
            ),
            default => sprintf(
                '%s recorded the most %s (%s, %s%% of the total).%s',
                $names($extremes['highest']),
                $config['label'],
                $top['value'],
                $this->percent($this->groupShare($highest, $barangays, $config['key'])),
                $this->countTail($config, $extremes, $barangays),
            ),
        };
    }

    /** The tied group's combined share of the city total for a count metric. */
    private function groupShare(Collection $group, array $barangays, string $key): float
    {
        $total = (int) collect($barangays)->sum($key);

        if ($total === 0) {
            return 0.0;
        }

        return ((int) $group->sum('value')) / $total;
    }

    /**
     * The "and none" / "lowest was" tail of a count-metric sentence.
     *
     * @param  array{highest: list<array<string, mixed>>, lowest: list<array<string, mixed>>}  $extremes
     * @param  list<array<string, mixed>>  $barangays
     */
    private function countTail(array $config, array $extremes, array $barangays): string
    {
        $bottom = collect($extremes['lowest'])->first();

        if ((float) $bottom['value'] === 0.0) {
            $zeros = collect($barangays)
                ->filter(fn (array $row): bool => $row[$config['key']] === 0)
                ->pluck('name');

            return sprintf(' %s recorded none.', $zeros->implode(' and '));
        }

        return sprintf(
            ' The lowest was %s (%s).',
            collect($extremes['lowest'])->pluck('name')->implode(' and '),
            $bottom['value'],
        );
    }

    /** A share as a whole-number percentage string. */
    private function percent(int|float $fraction): string
    {
        return (string) (int) round($fraction * 100);
    }

    private function isScoped(User $viewer): bool
    {
        return $viewer->role === 'technician';
    }

    /**
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>, per_1000?: bool}  $filters
     * @return array<string, mixed>
     */
    private function filterEcho(array $filters): array
    {
        return [
            'from' => $filters['from']?->toDateString(),
            'to' => $filters['to']?->toDateString(),
            'animal_type_id' => $filters['animal_type_id'],
            'classification_id' => $filters['classification_id'],
            'event_types' => $filters['event_types'],
        ];
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    private function cacheKey(string $name, User $viewer, array $filters, int $minRateAnimals): string
    {
        // The viewer rides in the key because a technician's scoped answer is
        // a different answer to the same filters — same convention as the
        // city report cache. The v2 prefix keeps entries written by the
        // earlier object-caching shape from ever being unserialized here.
        return 'analytics:barangay-dispersal:v2:'.$name.':'.md5((string) json_encode([
            'viewer' => $viewer->id,
            'role' => $viewer->role,
            'min_rate_animals' => $minRateAnimals,
            'filters' => $filters,
        ]));
    }
}
