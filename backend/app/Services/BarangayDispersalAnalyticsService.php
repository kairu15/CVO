<?php

namespace App\Services;

use App\Models\AnimalOwnershipEvent;
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
     * One barangay's card: the SAME filtered row the table/map use, plus the
     * recipients those movements delivered animals to.
     *
     * The card is opened by clicking a polygon, so it must never disagree
     * with the polygon's fill or the barangay table: the row is taken from
     * barangaySummary() (same filters, same cache) rather than recomputed
     * with a second set of rules. Null when the barangay is not one of the
     * covered rows.
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>, per_1000: bool}  $filters
     * @return array<string, mixed>|null
     */
    public function barangayDetail(User $viewer, int $barangayId, array $filters): ?array
    {
        $summary = $this->barangaySummary($viewer, $filters);

        $row = collect($summary['barangays'])
            ->first(fn (array $candidate): bool => (int) $candidate['barangay_id'] === $barangayId);

        if ($row === null) {
            return null;
        }

        return [
            'barangay' => $row,
            'recipients' => $this->recipients($viewer, $filters, $barangayId),
            'filters' => $summary['filters'],
            'scoped' => $summary['scoped'],
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /**
     * Who received animals IN one barangay, under the active filters.
     *
     * This is the destination side of the metrics above: the barangay's own
     * dispersals plus re-dispersals/pass-ons arriving from elsewhere. Rows are
     * GROUPED by animal type, recipient and date so the card can say
     * "2 × Swine (Pig) · Aling Nena · 12 Oct 2026" instead of repeating the
     * same household once per animal. Ear tags are deliberately omitted — the
     * card answers "who received what, when", and the animal list belongs on
     * the animal screens.
     *
     * @param  array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>}  $filters
     * @return list<array{event_date: string, animal_type: string, recipient_name: string, quantity: int}>
     */
    private function recipients(User $viewer, array $filters, int $barangayId): array
    {
        $types = array_values(array_intersect(
            [AnimalOwnershipEvent::TYPE_DISPERSAL, ...self::RE_DISPERSAL_TYPES],
            $filters['event_types'],
        ));

        if ($types === []) {
            return [];
        }

        return $this->baseQuery($viewer, $filters, $types)
            ->where('e.to_barangay_id', $barangayId)
            ->whereNotNull('e.to_beneficiary_id')
            ->leftJoin('animals as ra', 'ra.id', '=', 'e.animal_id')
            ->leftJoin('beneficiaries as rb', 'rb.id', '=', 'e.to_beneficiary_id')
            // The event TYPE is deliberately not grouped on: the card does not
            // show it, and splitting on it would print two identical rows for
            // an initial dispersal and a handover to the same household on the
            // same day.
            ->groupBy('e.event_date', 'ra.animal_type', 'rb.name_of_farmer')
            ->orderByDesc('e.event_date')
            ->orderBy('rb.name_of_farmer')
            ->selectRaw(implode(', ', [
                'e.event_date as event_date',
                "coalesce(ra.animal_type, 'Unspecified') as animal_type",
                "coalesce(rb.name_of_farmer, 'Unknown recipient') as recipient_name",
                'count(*) as quantity',
            ]))
            ->limit(200)
            ->get()
            ->map(fn (object $row): array => [
                'event_date' => substr((string) $row->event_date, 0, 10),
                'animal_type' => (string) $row->animal_type,
                'recipient_name' => (string) $row->recipient_name,
                'quantity' => (int) $row->quantity,
            ])
            ->all();
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
