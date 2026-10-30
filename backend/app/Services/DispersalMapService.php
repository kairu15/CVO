<?php

namespace App\Services;

use App\Models\AnimalOwnershipEvent;
use App\Models\User;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The dispersal map's dated snapshot — the numbers behind the pins AND the
 * barangay polygons, computed in SQL so both always answer from the same
 * query snapshot.
 *
 * DATE MODES (stated here because the office may tune them later):
 *
 *   on     "On this date": each animal whose LAST active event of that day
 *          (ties broken by id, so a same-day re-dispersal wins over the
 *          morning's dispersal) left it held by a beneficiary. Pinned at the
 *          recipient. An animal whose day ended with a `return` is back at
 *          CVO and is NOT pinned.
 *   as_of  "As of this date": each animal whose latest active event on or
 *          before the day left it held by a beneficiary. An animal
 *          re-dispersed later still appears at its earlier owner when an
 *          earlier date is chosen — that is the point of the mode.
 *
 *   `return` events therefore never produce a pin in either mode; they only
 *   ever END a pin's presence on the map.
 *
 * LOCATION: a pin sits at its OWNER's registered coordinates when the
 * household has them (location_source carried through from the household
 * row). A household without a pin falls back to its barangay centre —
 * location_source `barangay_centroid`, approximate=true. No barangay centre
 * either → the pin has null coordinates: never invented, reported through
 * `skipped_no_location`, and the UI lists it under "Location not recorded".
 * Invalid coordinate values are dropped the same way (with a log line).
 *
 * MASKING (the existing role rule, from AnimalDispersalService): admin and
 * doctor see owner names and pins; a technician sees them only for
 * households assigned to them — everyone else renders as "Beneficiary in
 * {barangay}" pinned at the barangay centre, approximate.
 *
 * SCOPING: a technician's snapshot ranks only the events that touch a
 * household assigned to them (the same boundary BarangayDispersalAnalyticsService
 * draws), so their map answers from their own caseload.
 */
class DispersalMapService
{
    /** How long a snapshot answer is reused (same policy as the analytics). */
    private const CACHE_SECONDS = 60;

    /** "Pins for events recorded that day only." */
    public const MODE_ON = 'on';

    /** "Every animal's state at the end of that day." */
    public const MODE_AS_OF = 'as_of';

    /** @var list<string> */
    public const MODES = [self::MODE_ON, self::MODE_AS_OF];

    /**
     * The dates that have active events, newest first, each with the number
     * of events and the number of distinct barangays they touched.
     *
     * @param  User  $viewer
     * @param  array{from: ?string, to: ?string}  $window
     * @param  int  $page  1-based
     * @param  int  $perPage
     * @return array<string, mixed>
     */
    public function dates(User $viewer, array $window, int $page, int $perPage): array
    {
        $page = max(1, $page);
        $perPage = min(200, max(1, $perPage));

        // Grouped SQL (not PHP) so a long history costs one index scan per
        // query, not one query per date; aoe_status_date_idx serves both.
        $counts = $this->scopedEvents($viewer)
            ->when($window['from'] !== null, fn (Builder $q): Builder => $q->where('e.event_date', '>=', $window['from'].' 00:00:00'))
            ->when($window['to'] !== null, fn (Builder $q): Builder => $q->where('e.event_date', '<=', $window['to'].' 23:59:59'))
            ->groupBy('e.event_date')
            ->selectRaw('e.event_date as day, count(*) as event_count');

        $fromSide = $this->scopedEvents($viewer)
            ->when($window['from'] !== null, fn (Builder $q): Builder => $q->where('e.event_date', '>=', $window['from'].' 00:00:00'))
            ->when($window['to'] !== null, fn (Builder $q): Builder => $q->where('e.event_date', '<=', $window['to'].' 23:59:59'))
            ->whereNotNull('e.from_barangay_id')
            ->selectRaw('e.event_date as day, e.from_barangay_id as barangay_id');

        $toSide = $this->scopedEvents($viewer)
            ->when($window['from'] !== null, fn (Builder $q): Builder => $q->where('e.event_date', '>=', $window['from'].' 00:00:00'))
            ->when($window['to'] !== null, fn (Builder $q): Builder => $q->where('e.event_date', '<=', $window['to'].' 23:59:59'))
            ->whereNotNull('e.to_barangay_id')
            ->selectRaw('e.event_date as day, e.to_barangay_id as barangay_id');

        $touched = $fromSide->unionAll($toSide);

        $barangayCounts = DB::query()
            ->fromSub($touched, 'sides')
            ->groupBy('sides.day')
            ->selectRaw('sides.day, count(distinct sides.barangay_id) as barangay_count');

        $total = (int) DB::query()->fromSub($counts, 'days')->count();

        // Both grouped shapes carry the day under the same name, so the join
        // is on the raw value and the API formats it to Y-m-d once.
        $rows = DB::query()
            ->fromSub($counts, 'd')
            ->leftJoinSub($barangayCounts, 'b', 'b.day', '=', 'd.day')
            ->orderByDesc('d.day')
            ->forPage($page, $perPage)
            ->get();

        return [
            'dates' => $rows->map(fn (object $row): array => [
                'date' => substr((string) $row->day, 0, 10),
                'event_count' => (int) $row->event_count,
                'barangay_count' => (int) ($row->barangay_count ?? 0),
            ])->all(),
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'scoped' => $this->isScoped($viewer),
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /**
     * The pins + per-barangay counts for one date and mode — ONE payload so
     * the polygons and the pins can never disagree.
     *
     * @param  User  $viewer
     * @param  Carbon|null  $date  null = nothing selected → an empty snapshot
     * @param  string  $mode  self::MODE_ON | self::MODE_AS_OF
     * @return array<string, mixed>
     */
    public function snapshot(User $viewer, ?Carbon $date, string $mode): array
    {
        if ($date === null) {
            return $this->emptySnapshot($mode);
        }

        // The newest active event anywhere is the cache invalidator: until a
        // new event (or a void) lands, the same (date, mode, viewer) question
        // has the same answer. Plain arrays only — see the analytics cache
        // note on serializable_classes => false.
        $latestEventId = (int) DB::table('animal_ownership_events')
            ->where('status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->max('id');

        $payload = Cache::remember(
            $this->cacheKey($viewer, $date, $mode, $latestEventId),
            self::CACHE_SECONDS,
            fn (): array => $this->buildSnapshot($viewer, $date, $mode),
        );

        return [...$payload, 'generated_at' => now()->toIso8601String()];
    }

    /* ------------------------------------------------------------------ *
     |  Internals                                                          |
     * ------------------------------------------------------------------ */

    private function emptySnapshot(string $mode): array
    {
        return [
            'pins' => [],
            // Even an empty day paints the city: every covered barangay at 0.
            'barangays' => $this->barangayRows(collect()),
            'skipped_no_location' => 0,
            'mode' => $mode,
            'date' => null,
            'scoped' => false,
        ];
    }

    private function buildSnapshot(User $viewer, Carbon $date, string $mode): array
    {
        // The latest event per animal within the mode's window; the window
        // filter goes INSIDE the ranking so "latest" means latest within it.
        $ranked = $this->scopedEvents($viewer)
            ->where('e.event_date', '<=', $date->toDateString().' 23:59:59')
            ->when($mode === self::MODE_ON, fn (Builder $q): Builder => $q->where(
                'e.event_date',
                '>=',
                $date->toDateString().' 00:00:00',
            ))
            ->selectRaw(
                'e.*, row_number() over (partition by e.animal_id order by e.event_date desc, e.id desc) as rank_in_chain',
            );

        // One row per animal: its chain's latest event in the window, kept
        // only when the animal ended up WITH a household (a return ends the
        // chain at CVO — no pin). The owner joins WITH their barangay centre
        // so the fallback needs no per-pin queries.
        $rows = DB::query()
            ->fromSub($ranked, 'r')
            ->where('r.rank_in_chain', 1)
            ->whereNotNull('r.to_beneficiary_id')
            ->join('animals as a', 'a.id', '=', 'r.animal_id')
            ->whereNull('a.deleted_at')
            ->leftJoin('beneficiaries as o', 'o.id', '=', 'r.to_beneficiary_id')
            ->leftJoin('barangays as ob', 'ob.id', '=', 'o.barangay_id')
            ->leftJoin('barangays as tb', 'tb.id', '=', 'r.to_barangay_id')
            ->selectRaw(implode(', ', [
                'r.id as event_id',
                'r.event_type',
                'r.event_date',
                'r.animal_id',
                'r.to_beneficiary_id',
                'r.to_barangay_id',
                'a.ear_tag_number',
                'a.animal_type',
                'a.status as animal_status',
                'o.name_of_farmer',
                'o.technician_id',
                'o.latitude as owner_lat',
                'o.longitude as owner_lng',
                'o.location_source as owner_source',
                'o.barangay_id as owner_barangay_id',
                'ob.name as owner_barangay',
                'ob.latitude as owner_center_lat',
                'ob.longitude as owner_center_lng',
                'tb.name as to_barangay_name',
            ]))
            ->get();

        $maskedOwners = $this->isScoped($viewer);
        $skipped = 0;
        $pins = [];

        foreach ($rows as $row) {
            // The pin's barangay: the handover snapshot when it exists, the
            // owner's barangay otherwise — the barangay the animal actually
            // sits in. Either may be null ("no barangay on record").
            $barangayId = $row->to_barangay_id ?? $row->owner_barangay_id;
            $barangayName = $row->to_barangay_id !== null
                ? $row->to_barangay_name
                : $row->owner_barangay;

            $masked = $maskedOwners && (int) $row->technician_id !== (int) $viewer->id;
            $label = $masked
                ? ($row->owner_barangay !== null ? "Beneficiary in {$row->owner_barangay}" : 'Beneficiary (location hidden)')
                : $row->name_of_farmer;

            // Location: the household's own pin; the barangay centre when the
            // household has none or must be masked; nothing when neither
            // exists. Coordinates are validated before they are served.
            [$latitude, $longitude, $source, $approximate] = $masked
                ? $this->centerOf($row->owner_center_lat, $row->owner_center_lng)
                : $this->ownerLocation($row);

            if ($latitude === null || $longitude === null) {
                $skipped += 1;
                Log::warning('map.pin.skipped_no_location', [
                    'animal_id' => (int) $row->animal_id,
                    'event_id' => (int) $row->event_id,
                    'owner_barangay' => $barangayName,
                ]);
            }

            $pins[] = [
                'animal_id' => (int) $row->animal_id,
                'animal_type' => $row->animal_type,
                'ear_tag_number' => $row->ear_tag_number,
                'animal_status' => $row->animal_status,
                'owner' => [
                    'id' => $masked ? null : (int) $row->to_beneficiary_id,
                    'label' => $label,
                    'masked' => $masked,
                ],
                'barangay_id' => $barangayId !== null ? (int) $barangayId : null,
                'barangay' => $barangayName,
                'latitude' => $latitude,
                'longitude' => $longitude,
                'location_source' => $source,
                'approximate' => $approximate,
                'last_event_id' => (int) $row->event_id,
                'last_event_date' => substr((string) $row->event_date, 0, 10),
                'event_type' => $row->event_type,
            ];
        }

        return [
            'pins' => $pins,
            // The polygon rows come from the SAME pin list, so a polygon can
            // never show a count the pins below it do not add up to.
            'barangays' => $this->barangayRows(collect($pins)),
            'skipped_no_location' => $skipped,
            'mode' => $mode,
            'date' => $date->toDateString(),
            'scoped' => $maskedOwners,
        ];
    }

    /**
     * One row per covered barangay — zeros included, so a barangay with
     * nothing on the selected date still paints (the lightest fill, not grey).
     *
     * @param  Collection<int, array<string, mixed>>  $pins
     * @return list<array<string, mixed>>
     */
    private function barangayRows(Collection $pins): array
    {
        $counts = $pins
            ->filter(fn (array $pin): bool => $pin['barangay_id'] !== null)
            ->groupBy('barangay_id');

        return DB::table('barangays as b')
            ->orderBy('b.id')
            ->selectRaw('b.id, b.name, b.latitude, b.longitude')
            ->get()
            ->map(fn (object $row): array => [
                'barangay_id' => (int) $row->id,
                'name' => $row->name,
                'latitude' => (float) $row->latitude,
                'longitude' => (float) $row->longitude,
                'pins' => (int) ($counts->get((int) $row->id)?->count() ?? 0),
            ])
            ->all();
    }

    /**
     * The household's own location, validated. A missing or out-of-range
     * pair falls through to the barangay-centroid fallback; the caller
     * reports what could not be placed.
     *
     * @param  object  $row  the joined snapshot row
     * @return array{0: ?float, 1: ?float, 2: ?string, 3: bool} lat, lng, source, approximate
     */
    private function ownerLocation(object $row): array
    {
        $latitude = $row->owner_lat;
        $longitude = $row->owner_lng;

        if ($this->validPair($latitude, $longitude)) {
            return [(float) $latitude, (float) $longitude, $row->owner_source, false];
        }

        if ($latitude !== null || $longitude !== null) {
            // A half-present or out-of-range pair is a data bug, not a
            // missing pin — say so rather than silently shifting the pin.
            Log::warning('map.pin.invalid_owner_coordinates', [
                'animal_id' => (int) $row->animal_id,
                'owner_barangay' => $row->owner_barangay,
            ]);
        }

        [$latitude, $longitude] = $this->centerOf($row->owner_center_lat, $row->owner_center_lng);

        return [$latitude, $longitude, $latitude !== null ? 'barangay_centroid' : null, $latitude !== null];
    }

    /**
     * @return array{0: ?float, 1: ?float, 2: ?string, 3: bool}
     */
    private function centerOf(mixed $latitude, mixed $longitude): array
    {
        if (! $this->validPair($latitude, $longitude)) {
            return [null, null, null, true];
        }

        return [(float) $latitude, (float) $longitude, 'barangay_centroid', true];
    }

    /** A coordinate pair is served only when both numbers are in range. */
    private function validPair(mixed $latitude, mixed $longitude): bool
    {
        return is_numeric($latitude)
            && is_numeric($longitude)
            && (float) $latitude >= -90
            && (float) $latitude <= 90
            && (float) $longitude >= -180
            && (float) $longitude <= 180;
    }

    /**
     * The active events the viewer may see, before any window filter — the
     * one base query every arm of the snapshot starts from.
     */
    private function scopedEvents(User $viewer): Builder
    {
        $query = DB::table('animal_ownership_events as e')
            ->where('e.status', AnimalOwnershipEvent::STATUS_ACTIVE);

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

    private function isScoped(User $viewer): bool
    {
        return $viewer->role === 'technician';
    }

    private function cacheKey(User $viewer, Carbon $date, string $mode, int $latestEventId): string
    {
        // The viewer rides in the key because a technician's scoped answer is
        // a different answer to the same date (same convention as the
        // analytics cache); the latest event id is the invalidator.
        return 'map:snapshot:v1:'.md5((string) json_encode([
            'viewer' => $viewer->id,
            'role' => $viewer->role,
            'date' => $date->toDateString(),
            'mode' => $mode,
            'latest_event_id' => $latestEventId,
        ]));
    }
}
