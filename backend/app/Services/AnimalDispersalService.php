<?php

namespace App\Services;

use App\Exceptions\OwnershipConflict;
use App\Models\Animal;
use App\Models\AnimalOwnershipEvent;
use App\Models\AnimalType;
use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\Barangays;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The single write path for an animal's ownership chain, and the single read
 * path the flight path is drawn from.
 *
 * Every UI and endpoint goes through here, so the rules live in exactly one
 * place:
 *
 *   - the whole call is ONE transaction with a row lock on the animal, so two
 *     simultaneous handovers of the same animal cannot both succeed;
 *   - `base_event_id` must be the animal's latest active event (stale =
 *     409 `stale_event`), which is what makes an offline replay safe;
 *   - the chain is validated on write (no future dates, no dates before the
 *     previous event, no backdating past the configured window);
 *   - `animals.current_owner_id` is recomputed in the same transaction;
 *   - exactly ONE audit row and one notification set are written per call.
 *
 * Events are append-only: a mistake is corrected with `voidEvent()`, after
 * which the current owner is recomputed from the active rows that remain.
 */
class AnimalDispersalService
{
    public function __construct(
        private readonly AuditLogger $audit,
        private readonly SettingsService $settings,
    ) {}

    /* ------------------------------------------------------------------ *
     |  Reads                                                              |
     * ------------------------------------------------------------------ */

    /**
     * The animals this user may see. Admin and doctor have program-wide
     * oversight; a technician only sees animals whose chain touches a
     * household assigned to them (their current holder, or any past handover).
     */
    public function scopeQueryFor(User $user): Builder
    {
        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return Animal::query();
        }

        if ($user->role === 'technician') {
            return Animal::query()->visibleTo($user->id);
        }

        return Animal::query()->whereRaw('0 = 1');
    }

    /**
     * One animal, scoped. A technician pointing at an animal outside their
     * assignment is an access boundary (403), not a missing row (404) — the
     * same distinction BeneficiaryService::findFor makes.
     *
     * @throws ModelNotFoundException
     * @throws AuthorizationException
     */
    public function findFor(User $user, int $animalId): Animal
    {
        $animal = $this->scopeQueryFor($user)->with(['animalType', 'animalClassification'])->find($animalId);

        if ($animal) {
            return $animal;
        }

        if ($user->role === 'technician' && Animal::query()->whereKey($animalId)->exists()) {
            throw new AuthorizationException('This animal is not assigned to you.');
        }

        abort(404);
    }

    /**
     * The animals a household currently holds — what the Dispersal dialog
     * needs to offer re-disperse / pass on / return for that beneficiary in
     * the UI (a household holds one animal in the programme's model, but the
     * shape stays a list so the caller never has to assume it).
     *
     * `current_owner_id` is the denormalised mirror of the latest active event,
     * so this is an index lookup rather than a walk of every chain.
     *
     * @return Collection<int, Animal>
     */
    public function animalsOwnedBy(User $user, int $beneficiaryId): Collection
    {
        $beneficiary = Beneficiary::query()->withTrashed()->find($beneficiaryId);

        if ($beneficiary === null) {
            abort(404);
        }

        // A technician may only look up a household assigned to them — the same
        // boundary BeneficiaryService::findFor enforces.
        if (! in_array($user->role, ['admin', 'doctor'], true)
            && (int) $beneficiary->technician_id !== (int) $user->id) {
            throw new AuthorizationException('This farmer is not assigned to you.');
        }

        return Animal::query()
            ->where('current_owner_id', $beneficiaryId)
            ->with(['animalType', 'animalClassification'])
            ->orderBy('id')
            ->get();
    }

    /**
     * One animal's chain, oldest first, with the visibility rule applied:
     * a technician sees full detail for owners assigned to them and
     * "Beneficiary in [barangay]" (barangay-level location only) for the rest.
     *
     * @return array{animal: Animal, current_owner: array<string, mixed>|null, events: list<array<string, mixed>>}
     */
    public function ownershipChainFor(User $user, int $animalId, bool $includeVoided = false): array
    {
        $animal = $this->findFor($user, $animalId);

        $events = $this->eventsQuery($animal, $includeVoided);

        return [
            'animal' => $animal,
            'current_owner' => $this->ownerPayload($user, $animal->currentOwner),
            'events' => $events->map(fn (AnimalOwnershipEvent $e): array => $this->chainEventPayload($user, $e))->all(),
            'latest_event_id' => $this->latestActiveEvent($animal)?->id,
        ];
    }

    /**
     * The ready-to-draw flight path: the CVO origin node followed by one node
     * per handover, plus the segments between located nodes.
     *
     * Computed here — not in the web or mobile client — so both draw the SAME
     * path and it can be cached offline from one canonical shape.
     *
     * A node's coordinate resolves in a fixed order: the event's own location,
     * then the owner's geotag, then the barangay centre (marked `approximate`).
     * A node with none of the three carries null coordinates, is tagged
     * `location_recorded = false`, and is skipped on the map by the client but
     * still listed ("location not recorded"). Coordinates are never invented.
     *
     * @return array<string, mixed>
     */
    public function flightPathFor(User $user, int $animalId, bool $includeVoided = false): array
    {
        $animal = $this->findFor($user, $animalId);

        $events = $this->eventsQuery($animal, $includeVoided);

        $originLat = $this->settings->officeLatitude();
        $originLng = $this->settings->officeLongitude();

        $nodes = [[
            'index' => 0,
            'kind' => 'origin',
            'label' => 'CVO',
            'owner_id' => null,
            'barangay' => null,
            'latitude' => $originLat,
            'longitude' => $originLng,
            'approximate' => false,
            'masked' => false,
            'event_id' => null,
            'event_type' => null,
            'held_from' => null,
            'held_to' => $events->first()?->event_date?->toDateString(),
            'location_recorded' => true,
            'current' => false,
            'voided' => false,
        ]];

        $index = 0;

        foreach ($events as $event) {
            $index++;

            $isReturn = $event->event_type === AnimalOwnershipEvent::TYPE_RETURN;
            $owner = $event->toBeneficiary;
            $location = $this->resolveNodeLocation($event, $owner, $user);

            $nodes[] = [
                'index' => $index,
                'kind' => $isReturn ? 'cvo-return' : 'owner',
                'label' => $isReturn ? 'CVO' : $location['label'],
                'owner_id' => $isReturn ? null : $location['owner_id'],
                'barangay' => $isReturn ? null : $location['barangay'],
                // A return to CVO with no captured location falls back to the
                // office coordinate — the animal is, by definition, back there.
                'latitude' => $isReturn && $location['latitude'] === null ? $originLat : $location['latitude'],
                'longitude' => $isReturn && $location['longitude'] === null ? $originLng : $location['longitude'],
                'approximate' => $isReturn ? false : $location['approximate'],
                'masked' => $isReturn ? false : $location['masked'],
                'event_id' => $event->id,
                'event_type' => $event->event_type,
                'held_from' => $event->event_date?->toDateString(),
                'held_to' => null,
                'location_recorded' => $isReturn || $location['latitude'] !== null,
                'current' => false,
                'voided' => $event->isVoided(),
            ];
        }

        // Each node is "held" until the next node's date; the last open node
        // has no end, which is how the client knows it is current.
        for ($i = 0; $i + 1 < count($nodes); $i++) {
            $nodes[$i]['held_to'] = $nodes[$i + 1]['held_from'];
        }

        // Mark the current holder among the ACTIVE nodes (the last one).
        if ($events->isNotEmpty()) {
            $lastActiveIndex = null;

            foreach ($nodes as $i => $node) {
                if ($i > 0 && ! $node['voided']) {
                    $lastActiveIndex = $i;
                }
            }

            if ($lastActiveIndex !== null) {
                $nodes[$lastActiveIndex]['current'] = true;
            }
        }

        // Segments connect consecutive LOCATED nodes; unlocated nodes (and the
        // nodes they orphan) simply do not break the drawn line.
        $segments = [];
        $lastLocated = 0;

        for ($i = 1; $i < count($nodes); $i++) {
            if ($nodes[$i]['latitude'] === null || $nodes[$i]['longitude'] === null) {
                continue;
            }

            $segments[] = [
                'from_index' => $lastLocated,
                'to_index' => $i,
                'date' => $nodes[$i]['held_from'],
                'event_type' => $nodes[$i]['event_type'],
                'event_id' => $nodes[$i]['event_id'],
                'voided' => $nodes[$i]['voided'],
                'approximate' => $nodes[$i]['approximate'] || $nodes[$lastLocated]['approximate'],
            ];

            $lastLocated = $i;
        }

        return [
            'animal_id' => $animal->id,
            'ear_tag_number' => $animal->ear_tag_number,
            'animal_type' => $animal->typeName(),
            'classification' => $animal->animalClassification?->name,
            'status' => $animal->status,
            'parent_animal_id' => $animal->parent_animal_id,
            'current_owner' => $this->ownerPayload($user, $animal->currentOwner),
            'origin' => [
                'label' => 'CVO',
                'latitude' => $originLat,
                'longitude' => $originLng,
            ],
            'nodes' => $nodes,
            'segments' => $segments,
            'latest_event_id' => $this->latestActiveEvent($animal)?->id,
            'has_unlocated_nodes' => collect($nodes)->contains(fn (array $n): bool => ! $n['location_recorded']),
        ];
    }

    /* ------------------------------------------------------------------ *
     |  Writes                                                             |
     * ------------------------------------------------------------------ */

    /**
     * Create an animal and its first (`dispersal`) event, from CVO to the
     * chosen beneficiary.
     *
     * @param  array<string, mixed>  $data
     */
    public function disperse(User $actor, array $data): AnimalOwnershipEvent
    {
        return DB::transaction(function () use ($actor, $data): AnimalOwnershipEvent {
            $owner = $this->resolveActiveBeneficiary((int) $data['to_beneficiary_id']);
            $this->assertMayRecordFor($actor, $owner);

            $earTag = $this->normalizeEarTag($data['ear_tag_number'] ?? null);
            $this->assertEarTagAvailable($earTag);

            [$typeId, $classificationId, $typeName] = $this->resolveTypePair($data);
            $eventDate = $this->parseEventDate($data['event_date'] ?? null);
            $this->assertEventDate(null, $eventDate);

            // The service writes ONE audit row for this call (below), so the
            // animal's own auto-audit is suppressed to avoid a second row for
            // the same moment.
            $animal = new Animal([
                'ear_tag_number' => $earTag,
                'animal_type' => $typeName,
                'animal_type_id' => $typeId,
                'classification_id' => $classificationId,
                'sex' => $data['sex'] ?? null,
                'parent_animal_id' => null,
                'current_owner_id' => $owner->id,
                'status' => Animal::STATUS_ACTIVE,
            ]);
            $animal->skipNextAudit();
            $animal->save();

            $event = AnimalOwnershipEvent::create([
                'animal_id' => $animal->id,
                'event_type' => AnimalOwnershipEvent::TYPE_DISPERSAL,
                'from_beneficiary_id' => null,
                'to_beneficiary_id' => $owner->id,
                // Snapshot where the household WAS at handover time — the
                // analytics reads these, so a later edit of the beneficiary's
                // barangay cannot rewrite history.
                'from_barangay_id' => null,
                'to_barangay_id' => $owner->barangay_id,
                'event_date' => $eventDate,
                'date_is_estimated' => (bool) ($data['date_is_estimated'] ?? false),
                ...$this->resolveLocation($data, $owner),
                'remarks' => $data['remarks'] ?? null,
                'recorded_by' => $actor->id,
                'status' => AnimalOwnershipEvent::STATUS_ACTIVE,
            ]);

            $this->recordAudit($actor, 'dispersal_recorded', $animal, $event);
            $this->notify($actor, $animal, $event, null, $owner);

            return $event;
        });
    }

    /**
     * Move the SAME animal to a new owner.
     *
     * @param  array<string, mixed>  $data
     */
    public function redisperse(User $actor, int $animalId, array $data): AnimalOwnershipEvent
    {
        return DB::transaction(function () use ($actor, $animalId, $data): AnimalOwnershipEvent {
            $animal = $this->lockAnimal($animalId);
            $this->assertAnimalActive($animal);
            $this->assertBaseEvent($animal, $data['base_event_id'] ?? null);

            $from = $animal->currentOwner;
            $this->assertMayRecordFor($actor, $from);

            $to = $this->resolveActiveBeneficiary((int) $data['to_beneficiary_id']);

            if ($from !== null && (int) $from->id === (int) $to->id) {
                throw ValidationException::withMessages([
                    'to_beneficiary_id' => 'The animal already belongs to this beneficiary.',
                ]);
            }

            $previous = $this->latestActiveEvent($animal);
            $eventDate = $this->parseEventDate($data['event_date'] ?? null);
            $this->assertEventDate($previous, $eventDate);

            $event = AnimalOwnershipEvent::create([
                'animal_id' => $animal->id,
                'event_type' => AnimalOwnershipEvent::TYPE_RE_DISPERSAL,
                'from_beneficiary_id' => $from?->id,
                'to_beneficiary_id' => $to->id,
                'from_barangay_id' => $from?->barangay_id,
                'to_barangay_id' => $to->barangay_id,
                'event_date' => $eventDate,
                'date_is_estimated' => (bool) ($data['date_is_estimated'] ?? false),
                ...$this->resolveLocation($data, $to),
                'remarks' => $data['remarks'] ?? null,
                'recorded_by' => $actor->id,
                'status' => AnimalOwnershipEvent::STATUS_ACTIVE,
            ]);

            $animal->skipNextAudit();
            $animal->update(['current_owner_id' => $to->id]);

            $this->recordAudit($actor, 're_dispersal_recorded', $animal, $event);
            $this->notify($actor, $animal, $event, $from, $to);

            return $event;
        });
    }

    /**
     * Create an offspring animal (linked to its parent) and record the
     * `pass_on` event that hands it to a new beneficiary. The parent's own
     * ownership is untouched.
     *
     * @param  array<string, mixed>  $data
     */
    public function passOn(User $actor, int $parentAnimalId, array $data): AnimalOwnershipEvent
    {
        return DB::transaction(function () use ($actor, $parentAnimalId, $data): AnimalOwnershipEvent {
            $parent = $this->lockAnimal($parentAnimalId);
            $this->assertAnimalActive($parent);
            $this->assertBaseEvent($parent, $data['base_event_id'] ?? null);

            $from = $parent->currentOwner;

            if ($from === null) {
                throw ValidationException::withMessages([
                    'parent_animal_id' => 'This animal is not with a beneficiary, so it has no offspring to pass on.',
                ]);
            }

            $this->assertMayRecordFor($actor, $from);

            $to = $this->resolveActiveBeneficiary((int) $data['to_beneficiary_id']);
            $earTag = $this->normalizeEarTag($data['ear_tag_number'] ?? null);
            $this->assertEarTagAvailable($earTag);

            [$typeId, $classificationId, $typeName] = $this->resolveTypePair($data, $parent);
            $eventDate = $this->parseEventDate($data['event_date'] ?? null);
            $this->assertEventDate(null, $eventDate);

            $offspring = new Animal([
                'ear_tag_number' => $earTag,
                'animal_type' => $typeName,
                'animal_type_id' => $typeId,
                'classification_id' => $classificationId,
                'sex' => $data['sex'] ?? null,
                'parent_animal_id' => $parent->id,
                'current_owner_id' => $to->id,
                'status' => Animal::STATUS_ACTIVE,
            ]);
            $offspring->skipNextAudit();
            $offspring->save();

            $event = AnimalOwnershipEvent::create([
                'animal_id' => $offspring->id,
                'event_type' => AnimalOwnershipEvent::TYPE_PASS_ON,
                'from_beneficiary_id' => $from->id,
                'to_beneficiary_id' => $to->id,
                'from_barangay_id' => $from->barangay_id,
                'to_barangay_id' => $to->barangay_id,
                'event_date' => $eventDate,
                'date_is_estimated' => (bool) ($data['date_is_estimated'] ?? false),
                ...$this->resolveLocation($data, $to),
                'remarks' => $data['remarks'] ?? null,
                'recorded_by' => $actor->id,
                'status' => AnimalOwnershipEvent::STATUS_ACTIVE,
            ]);

            $this->recordAudit($actor, 'pass_on_recorded', $offspring, $event);
            $this->notify($actor, $offspring, $event, $from, $to);

            return $event;
        });
    }

    /**
     * Hand the animal back to CVO: a `return` event, current owner cleared and
     * the animal marked `returned`.
     *
     * @param  array<string, mixed>  $data
     */
    public function returnToCvo(User $actor, int $animalId, array $data): AnimalOwnershipEvent
    {
        return DB::transaction(function () use ($actor, $animalId, $data): AnimalOwnershipEvent {
            $animal = $this->lockAnimal($animalId);
            $this->assertAnimalActive($animal);
            $this->assertBaseEvent($animal, $data['base_event_id'] ?? null);

            $from = $animal->currentOwner;

            if ($from === null) {
                throw ValidationException::withMessages([
                    'to_beneficiary_id' => 'The animal is already with CVO; there is nothing to return.',
                ]);
            }

            $this->assertMayRecordFor($actor, $from);

            $previous = $this->latestActiveEvent($animal);
            $eventDate = $this->parseEventDate($data['event_date'] ?? null);
            $this->assertEventDate($previous, $eventDate);

            $event = AnimalOwnershipEvent::create([
                'animal_id' => $animal->id,
                'event_type' => AnimalOwnershipEvent::TYPE_RETURN,
                'from_beneficiary_id' => $from->id,
                'to_beneficiary_id' => null,
                'from_barangay_id' => $from->barangay_id,
                'to_barangay_id' => null, // a return has no destination barangay: the animal is back at CVO
                'event_date' => $eventDate,
                'date_is_estimated' => (bool) ($data['date_is_estimated'] ?? false),
                ...$this->resolveLocation($data, null),
                'remarks' => $data['remarks'] ?? null,
                'recorded_by' => $actor->id,
                'status' => AnimalOwnershipEvent::STATUS_ACTIVE,
            ]);

            $animal->skipNextAudit();
            $animal->update([
                'current_owner_id' => null,
                'status' => Animal::STATUS_RETURNED,
            ]);

            $this->recordAudit($actor, 'return_recorded', $animal, $event);
            $this->notify($actor, $animal, $event, $from, null);

            return $event;
        });
    }

    /**
     * Void an event and recompute the animal's current owner from the active
     * rows that remain. This is the ONLY correction path — events are never
     * edited or deleted.
     */
    public function voidEvent(User $actor, int $eventId, string $reason): AnimalOwnershipEvent
    {
        return DB::transaction(function () use ($actor, $eventId, $reason): AnimalOwnershipEvent {
            $event = AnimalOwnershipEvent::query()->findOrFail($eventId);

            // Lock the animal first so a void and a concurrent handover of the
            // same animal serialise on one row.
            $animal = $this->lockAnimal($event->animal_id);
            $event->refresh();

            if ($event->isVoided()) {
                throw ValidationException::withMessages([
                    'event' => 'This event is already voided.',
                ]);
            }

            $event->update([
                'status' => AnimalOwnershipEvent::STATUS_VOIDED,
                'voided_by' => $actor->id,
                'voided_at' => now(),
                'void_reason' => $reason,
            ]);

            $this->recomputeOwner($animal);

            $this->audit->log($actor, 'dispersal_event_voided', $event, [
                'animal_id' => $animal->id,
                'ear_tag_number' => $animal->ear_tag_number,
                'event_type' => $event->event_type,
                'event_date' => $event->event_date?->toDateString(),
                'void_reason' => $reason,
            ]);

            $this->notify($actor, $animal, $event, $event->fromBeneficiary, $event->toBeneficiary);

            return $event->refresh();
        });
    }

    /**
     * Backfill the ownership chain from the OLDER beneficiary pass-on model.
     *
     * Every beneficiary is a household that holds one animal, so each becomes
     * one `animals` row with a first event: `dispersal` (from CVO) when the
     * household received an animal, or `pass_on` (from the household that
     * passed it on) when the old row was a re-dispersal. Rows are processed
     * oldest first, dispersals before pass-ons, so a pass-on can link to the
     * animal its parent household already produced.
     *
     * IDEMPOTENT: a household already carrying `legacy_beneficiary_id` is
     * skipped, so a re-run (or a `--dry-run` followed by a real run) creates
     * nothing twice. A date the old record never stored is marked
     * `date_is_estimated` rather than pretended exact.
     *
     * NOTHING IS REPAIRED SILENTLY: rows that cannot be migrated (a missing
     * household, a missing parent animal) and any chain breaks found after the
     * write are returned in the report for a human to act on.
     *
     * @return array<string, mixed>
     */
    public function backfillOwnership(bool $dryRun = false): array
    {
        $before = [
            'animals' => Animal::withTrashed()->count(),
            'events' => AnimalOwnershipEvent::count(),
        ];

        // The earliest delivery row per recipient household: the first moment
        // the household is on record as holding an animal.
        $deliveries = DispersalEvent::query()
            ->orderBy('date_dispersed')
            ->orderBy('id')
            ->get()
            ->groupBy('beneficiary_id')
            ->map(fn ($rows) => $rows->first());

        $beneficiaries = Beneficiary::withTrashed()
            ->whereIn('id', $deliveries->keys())
            ->get()
            ->keyBy('id');

        $alreadyMigrated = Animal::withTrashed()
            ->whereNotNull('legacy_beneficiary_id')
            ->pluck('legacy_beneficiary_id')
            ->flip();

        $unusable = [];
        $skipped = 0;
        $dispersals = [];
        $passOns = [];

        foreach ($deliveries as $beneficiaryId => $delivery) {
            $beneficiary = $beneficiaries->get($beneficiaryId);

            if ($beneficiary === null) {
                $unusable[] = ['beneficiary_id' => (int) $beneficiaryId, 'reason' => 'beneficiary_missing'];

                continue;
            }

            if ($alreadyMigrated->has($beneficiaryId)) {
                $skipped++;

                continue;
            }

            $rawDate = $delivery->date_dispersed ?? $beneficiary->created_at;

            if ($rawDate === null) {
                $unusable[] = ['beneficiary_id' => (int) $beneficiaryId, 'reason' => 'no_date'];

                continue;
            }

            $spec = [
                'beneficiary' => $beneficiary,
                'date' => Carbon::parse($rawDate)->startOfDay(),
                'estimated' => $delivery->date_dispersed === null,
            ];

            if ($delivery->dispersal_type === DispersalEvent::TYPE_RE_DISPERSAL) {
                $spec['from'] = $delivery->parent_beneficiary_id;
                $passOns[] = $spec;
            } else {
                $dispersals[] = $spec;
            }
        }

        usort($dispersals, fn (array $a, array $b): int => $a['date'] <=> $b['date']);
        usort($passOns, fn (array $a, array $b): int => $a['date'] <=> $b['date']);

        // Barangay snapshots for the backfilled events, resolved from the
        // households' barangay as recorded NOW (the best information that
        // exists for history). Both delivery recipients and pass-on sources
        // are covered; a household with no barangay backfills as NULL and is
        // reported by the command.
        $barangayByBeneficiaryId = Beneficiary::withTrashed()
            ->whereIn('id', collect($passOns)->pluck('from')->filter()->unique()->values())
            ->pluck('barangay_id', 'id')
            ->map(fn ($id) => $id === null ? null : (int) $id)
            ->all();

        foreach ($beneficiaries as $id => $beneficiary) {
            $barangayByBeneficiaryId[(int) $id] = $beneficiary->barangay_id === null
                ? null
                : (int) $beneficiary->barangay_id;
        }

        $migrated = 0;

        $write = function (array $spec, bool $isPassOn) use (&$migrated, &$unusable, $barangayByBeneficiaryId): void {
            /** @var Beneficiary $beneficiary */
            $beneficiary = $spec['beneficiary'];

            $parentAnimalId = null;

            if ($isPassOn) {
                $fromId = $spec['from'] ?? null;
                $parentAnimal = $fromId === null
                    ? null
                    : Animal::withTrashed()->where('legacy_beneficiary_id', $fromId)->first();
                $parentAnimalId = $parentAnimal?->id;

                if ($parentAnimalId === null) {
                    $unusable[] = [
                        'beneficiary_id' => (int) $beneficiary->id,
                        'reason' => 'parent_animal_missing',
                    ];
                }
            }

            $animal = new Animal([
                'ear_tag_number' => $beneficiary->ear_tag_number,
                'animal_type' => $beneficiary->animal_type,
                'animal_type_id' => $beneficiary->animal_type_id,
                'classification_id' => $beneficiary->classification_id,
                'sex' => $beneficiary->sex,
                'parent_animal_id' => $parentAnimalId,
                'current_owner_id' => $beneficiary->id,
                'status' => Animal::STATUS_ACTIVE,
                'legacy_beneficiary_id' => $beneficiary->id,
            ]);
            $animal->skipNextAudit();
            $animal->save();

            AnimalOwnershipEvent::create([
                'animal_id' => $animal->id,
                'event_type' => $isPassOn ? AnimalOwnershipEvent::TYPE_PASS_ON : AnimalOwnershipEvent::TYPE_DISPERSAL,
                'from_beneficiary_id' => $isPassOn ? ($spec['from'] ?? null) : null,
                'to_beneficiary_id' => $beneficiary->id,
                'from_barangay_id' => $isPassOn
                    ? ($barangayByBeneficiaryId[(int) ($spec['from'] ?? 0)] ?? null)
                    : null,
                'to_barangay_id' => $barangayByBeneficiaryId[(int) $beneficiary->id] ?? null,
                'event_date' => $spec['date'],
                'date_is_estimated' => $spec['estimated'],
                ...$this->resolveLocation([], $beneficiary),
                'remarks' => 'Backfilled from the household pass-on record.',
                'recorded_by' => null,
                'status' => AnimalOwnershipEvent::STATUS_ACTIVE,
            ]);

            $migrated++;
        };

        if (! $dryRun) {
            DB::transaction(function () use ($dispersals, $passOns, $write): void {
                foreach ($dispersals as $spec) {
                    $write($spec, false);
                }

                foreach ($passOns as $spec) {
                    $write($spec, true);
                }
            });
        }

        return [
            'dry_run' => $dryRun,
            'before' => $before,
            'after' => [
                'animals' => Animal::withTrashed()->count(),
                'events' => AnimalOwnershipEvent::count(),
            ],
            'migrated' => $dryRun ? count($dispersals) + count($passOns) : $migrated,
            'skipped' => $skipped,
            'without_delivery_event' => max(0, Beneficiary::withTrashed()->count() - $deliveries->count()),
            'unusable' => $unusable,
            'verify' => $this->verifyChain(),
        ];
    }

    /* ------------------------------------------------------------------ *
     |  Verification                                                       |
     * ------------------------------------------------------------------ */

    /**
     * Check the two invariants of the chain for every animal:
     *
     *   (a) each active event's `from` equals the previous active event's `to`;
     *   (b) `animals.current_owner_id` equals the last active event's `to`.
     *
     * Returns the breaks rather than repairing anything — a human decides.
     * Used by `php artisan ownership:verify` and by the tests.
     *
     * @return array{animals_checked: int, events_checked: int, breaks: list<array<string, mixed>>}
     */
    public function verifyChain(): array
    {
        $animals = Animal::query()
            ->with(['activeOwnershipEvents'])
            ->orderBy('id')
            ->get();

        $breaks = [];
        $eventsChecked = 0;

        foreach ($animals as $animal) {
            $events = $animal->activeOwnershipEvents;
            $previousTo = null;

            foreach ($events as $i => $event) {
                $eventsChecked++;

                // The first event has no previous link, so it is checked only
                // for having no source: a dispersal/re-dispersal starts at CVO
                // (`from` = null). A `pass_on` is the exception — an offspring
                // chain legitimately begins at the parent's household.
                $expectedFrom = $i === 0 ? null : $previousTo;

                $isStartedAtParent = $i === 0
                    && $event->event_type === AnimalOwnershipEvent::TYPE_PASS_ON;

                if (! $isStartedAtParent
                    && (int) ($event->from_beneficiary_id ?? 0) !== (int) ($expectedFrom ?? 0)) {
                    $breaks[] = [
                        'type' => 'from_mismatch',
                        'animal_id' => $animal->id,
                        'event_id' => $event->id,
                        'expected_from_beneficiary_id' => $expectedFrom,
                        'actual_from_beneficiary_id' => $event->from_beneficiary_id,
                    ];
                }

                $previousTo = $event->to_beneficiary_id;
            }

            if ((int) ($animal->current_owner_id ?? 0) !== (int) ($previousTo ?? 0)) {
                $breaks[] = [
                    'type' => 'current_owner_mismatch',
                    'animal_id' => $animal->id,
                    'event_id' => $events->last()?->id,
                    'expected_current_owner_id' => $previousTo,
                    'actual_current_owner_id' => $animal->current_owner_id,
                ];
            }
        }

        return [
            'animals_checked' => $animals->count(),
            'events_checked' => $eventsChecked,
            'breaks' => $breaks,
        ];
    }

    /* ------------------------------------------------------------------ *
     |  Internals                                                          |
     * ------------------------------------------------------------------ */

    /** @return Collection<int, AnimalOwnershipEvent> */
    private function eventsQuery(Animal $animal, bool $includeVoided)
    {
        return AnimalOwnershipEvent::query()
            ->where('animal_id', $animal->id)
            ->when(! $includeVoided, fn (Builder $q) => $q->where('status', AnimalOwnershipEvent::STATUS_ACTIVE))
            ->with(['fromBeneficiary.barangay', 'toBeneficiary.barangay', 'recordedBy', 'voidedBy'])
            ->chronological()   // event_date, then id
            ->get();
    }

    /** The animal row, locked for the duration of the transaction. */
    private function lockAnimal(int $animalId): Animal
    {
        $animal = Animal::query()->whereKey($animalId)->lockForUpdate()->first();

        if ($animal === null) {
            abort(404);
        }

        return $animal;
    }

    private function latestActiveEvent(Animal $animal): ?AnimalOwnershipEvent
    {
        return AnimalOwnershipEvent::query()
            ->where('animal_id', $animal->id)
            ->where('status', AnimalOwnershipEvent::STATUS_ACTIVE)
            ->orderByDesc('event_date')
            ->orderByDesc('id')
            ->first();
    }

    private function assertAnimalActive(Animal $animal): void
    {
        if (! $animal->isActive()) {
            throw OwnershipConflict::animalNotActive($animal->status);
        }
    }

    /**
     * The optimistic-concurrency guard. When the client supplies the latest
     * event it saw, the server refuses to append to a chain that has moved on.
     */
    private function assertBaseEvent(Animal $animal, int|string|null $baseEventId): void
    {
        if ($baseEventId === null) {
            return;
        }

        $latest = $this->latestActiveEvent($animal);

        if ($latest === null || (int) $latest->id !== (int) $baseEventId) {
            throw OwnershipConflict::staleEvent($latest?->id);
        }
    }

    /** Recompute the denormalised owner + status from the active events. */
    private function recomputeOwner(Animal $animal): void
    {
        $animal->refresh();
        $latest = $this->latestActiveEvent($animal);

        $status = $animal->status === Animal::STATUS_DECEASED
            ? Animal::STATUS_DECEASED
            : ($latest?->event_type === AnimalOwnershipEvent::TYPE_RETURN
                ? Animal::STATUS_RETURNED
                : Animal::STATUS_ACTIVE);

        $animal->skipNextAudit();
        $animal->update([
            'current_owner_id' => $latest?->to_beneficiary_id,
            'status' => $status,
        ]);
    }

    /**
     * The beneficiary receiving an animal — must exist and must not be
     * soft-deleted (the default query excludes trash, which covers both the
     * "inactive" and "deleted" cases the brief calls out, since a beneficiary
     * has no separate active flag).
     */
    private function resolveActiveBeneficiary(int $id): Beneficiary
    {
        $beneficiary = Beneficiary::query()->find($id);

        if ($beneficiary === null) {
            throw ValidationException::withMessages([
                'to_beneficiary_id' => 'The selected beneficiary could not be found or has been removed.',
            ]);
        }

        return $beneficiary;
    }

    /**
     * Who may record a handover: an admin always; a technician only for a
     * household assigned to them (the SOURCE on a re-dispersal/return/pass-on,
     * the RECIPIENT on an initial dispersal).
     */
    private function assertMayRecordFor(User $actor, ?Beneficiary $owner): void
    {
        if ($actor->role === 'admin') {
            return;
        }

        if ($actor->role === 'technician') {
            if ($owner !== null && (int) $owner->technician_id === (int) $actor->id) {
                return;
            }

            throw new AuthorizationException('You can only record handovers for households assigned to you.');
        }

        throw new AuthorizationException('You are not allowed to record animal handovers.');
    }

    /** @param array<string, mixed> $data */
    private function normalizeEarTag(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    /**
     * The ear tag is the human identity of the animal, so a duplicate would
     * make two animals indistinguishable in the field. Soft-deleted animals
     * still hold their tag on the animal itself, so they are checked too.
     */
    private function assertEarTagAvailable(?string $earTag): void
    {
        if ($earTag === null) {
            return;
        }

        if (Animal::query()->withTrashed()->where('ear_tag_number', $earTag)->exists()) {
            throw ValidationException::withMessages([
                'ear_tag_number' => 'This ear tag is already in use by another animal.',
            ]);
        }
    }

    /**
     * Resolve the submitted master-list pair. A type id wins; a type that
     * cannot be resolved leaves the FK pair null rather than guessing (the
     * display string is kept either way). A classification must belong to the
     * chosen type.
     *
     * @param  array<string, mixed>  $data
     * @return array{0: int|null, 1: int|null, 2: string|null}
     */
    private function resolveTypePair(array $data, ?Animal $parent = null): array
    {
        $typeId = isset($data['animal_type_id']) ? (int) $data['animal_type_id'] : null;

        if ($typeId === null && $parent !== null) {
            $typeId = $parent->animal_type_id;
        }

        $classificationId = array_key_exists('classification_id', $data) && $data['classification_id'] !== null
            ? (int) $data['classification_id']
            : null;

        $typeName = is_string($data['animal_type'] ?? null) && trim((string) $data['animal_type']) !== ''
            ? trim((string) $data['animal_type'])
            : null;

        if ($typeId === null) {
            return [null, null, $typeName];
        }

        $type = AnimalType::query()->find($typeId);

        if ($type === null) {
            throw ValidationException::withMessages([
                'animal_type_id' => 'Choose an animal type from the master list.',
            ]);
        }

        if ($classificationId !== null
            && ! app(AnimalTypeCatalog::class)->classificationBelongsTo($classificationId, $typeId)) {
            throw ValidationException::withMessages([
                'classification_id' => 'That classification does not belong to the chosen animal type.',
            ]);
        }

        return [$type->id, $classificationId, $typeName ?? $type->name];
    }

    /** Parse a submitted date in the application timezone, or default to today. */
    private function parseEventDate(mixed $value): Carbon
    {
        if ($value === null || $value === '') {
            return now()->startOfDay();
        }

        // Anchor to the app timezone BEFORE taking the start of day: a string
        // carrying an explicit offset (e.g. 23:59+08:00 from a mobile client)
        // must land on the calendar day it was in Asia/Manila, not on the day
        // its UTC rendering starts.
        return Carbon::parse((string) $value)
            ->timezone(config('app.timezone'))
            ->startOfDay();
    }

    /**
     * Chain-order and window rules. A future date is never allowed; a date
     * older than the configured backdating window is not; and a date earlier
     * than the previous event would rewrite history out of order.
     */
    private function assertEventDate(?AnimalOwnershipEvent $previous, Carbon $date): void
    {
        $today = now()->startOfDay();

        if ($date->greaterThan($today)) {
            throw ValidationException::withMessages([
                'event_date' => 'The date cannot be in the future.',
            ]);
        }

        $floor = $today->copy()->subDays($this->settings->dispersalMaxBackdateDays());

        if ($date->lessThan($floor)) {
            throw ValidationException::withMessages([
                'event_date' => "The date cannot be more than {$this->settings->dispersalMaxBackdateDays()} days in the past.",
            ]);
        }

        if ($previous !== null && $date->lessThan($previous->event_date->copy()->startOfDay())) {
            throw ValidationException::withMessages([
                'event_date' => 'The date cannot be earlier than the previous event ('
                    .$previous->event_date->toDateString().').',
            ]);
        }
    }

    /**
     * The location stored on the event, resolved in the documented order: an
     * explicit pin from the client, then the new owner's geotag, then the
     * barangay centre. Never invents a coordinate when none of the three
     * exists — the flight path marks those nodes "location not recorded".
     *
     * @param  array<string, mixed>  $data
     * @return array{latitude: float|null, longitude: float|null, location_source: string|null, accuracy_m: float|null}
     */
    private function resolveLocation(array $data, ?Beneficiary $owner): array
    {
        $lat = $data['latitude'] ?? null;
        $lng = $data['longitude'] ?? null;

        if ($lat !== null && $lng !== null) {
            return [
                'latitude' => (float) $lat,
                'longitude' => (float) $lng,
                'location_source' => $data['location_source'] ?? 'manual_pin',
                'accuracy_m' => isset($data['accuracy_m']) ? (float) $data['accuracy_m'] : null,
            ];
        }

        if ($owner !== null && $this->beneficiaryHasCoordinates($owner)) {
            return [
                'latitude' => (float) $owner->latitude,
                'longitude' => (float) $owner->longitude,
                'location_source' => 'owner_geotag',
                'accuracy_m' => null,
            ];
        }

        $center = $owner !== null ? $this->barangayCenter($owner) : null;

        if ($center !== null) {
            return [
                'latitude' => $center[0],
                'longitude' => $center[1],
                'location_source' => 'barangay_centroid',
                'accuracy_m' => null,
            ];
        }

        return ['latitude' => null, 'longitude' => null, 'location_source' => null, 'accuracy_m' => null];
    }

    /**
     * A node's coordinates in the flight path: the event's own location, then
     * the owner's geotag, then the barangay centre (approximate).
     *
     * @return array<string, mixed>
     */
    private function resolveNodeLocation(AnimalOwnershipEvent $event, ?Beneficiary $owner, User $user): array
    {
        $lat = $event->latitude;
        $lng = $event->longitude;
        $approximate = $event->location_source === 'barangay_centroid';

        if ($lat === null && $owner !== null && $this->beneficiaryHasCoordinates($owner)) {
            $lat = (float) $owner->latitude;
            $lng = (float) $owner->longitude;
            $approximate = false;
        }

        if ($lat === null && $owner !== null) {
            $center = $this->barangayCenter($owner);

            if ($center !== null) {
                $lat = $center[0];
                $lng = $center[1];
                $approximate = true;
            }
        }

        if ($owner === null) {
            return [
                'owner_id' => null,
                'label' => 'CVO',
                'barangay' => null,
                'latitude' => $lat,
                'longitude' => $lng,
                'approximate' => $approximate,
                'masked' => false,
            ];
        }

        $payload = $this->ownerPayload($user, $owner);

        // A masked owner exposes only barangay-level location: replace the pin
        // with the barangay centre and mark it approximate.
        if ($payload['masked']) {
            $center = $this->barangayCenter($owner);
            $lat = $center !== null ? $center[0] : null;
            $lng = $center !== null ? $center[1] : null;
            $approximate = true;
        }

        return [
            'owner_id' => $payload['id'],
            'label' => $payload['label'],
            'barangay' => $payload['barangay'],
            'latitude' => $lat,
            'longitude' => $lng,
            'approximate' => $approximate,
            'masked' => $payload['masked'],
        ];
    }

    /**
     * An owner as this user may see them. A technician sees the full household
     * only for owners assigned to them; every other owner collapses to
     * "Beneficiary in [barangay]" with the barangay centre as their location.
     *
     * @return array<string, mixed>|null
     */
    private function ownerPayload(User $user, ?Beneficiary $owner): ?array
    {
        if ($owner === null) {
            return null;
        }

        $barangay = $this->barangayName($owner);

        if (! $this->isMaskedFor($user, $owner)) {
            return [
                'id' => $owner->id,
                'label' => $owner->name_of_farmer,
                'barangay' => $barangay,
                'masked' => false,
                'approximate' => false,
                'latitude' => $this->beneficiaryHasCoordinates($owner) ? (float) $owner->latitude : null,
                'longitude' => $this->beneficiaryHasCoordinates($owner) ? (float) $owner->longitude : null,
            ];
        }

        $center = $this->barangayCenter($owner);

        return [
            'id' => null,
            'label' => $barangay !== null ? "Beneficiary in {$barangay}" : 'Beneficiary (location hidden)',
            'barangay' => $barangay,
            'masked' => true,
            'approximate' => true,
            'latitude' => $center[0] ?? null,
            'longitude' => $center[1] ?? null,
        ];
    }

    /** A technician is masked for any owner they are not assigned to. */
    private function isMaskedFor(User $user, Beneficiary $owner): bool
    {
        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return false;
        }

        if ($user->role === 'technician') {
            return (int) $owner->technician_id !== (int) $user->id;
        }

        return true;
    }

    /** @return array<string, mixed> */
    private function chainEventPayload(User $user, AnimalOwnershipEvent $event): array
    {
        return [
            'id' => $event->id,
            'animal_id' => $event->animal_id,
            'event_type' => $event->event_type,
            'event_date' => $event->event_date?->toDateString(),
            'date_is_estimated' => (bool) $event->date_is_estimated,
            'from' => $event->from_beneficiary_id === null
                ? ['id' => null, 'label' => 'CVO', 'barangay' => null, 'masked' => false, 'approximate' => false, 'latitude' => null, 'longitude' => null]
                : $this->ownerPayload($user, $event->fromBeneficiary),
            'to' => $event->to_beneficiary_id === null ? null : $this->ownerPayload($user, $event->toBeneficiary),
            'latitude' => $event->latitude,
            'longitude' => $event->longitude,
            'location_source' => $event->location_source,
            'accuracy_m' => $event->accuracy_m,
            'remarks' => $event->remarks,
            'recorded_by' => $event->recordedBy !== null
                ? ['id' => $event->recordedBy->id, 'name' => $event->recordedBy->name]
                : null,
            'status' => $event->status,
            'voided_at' => $event->voided_at?->toIso8601String(),
            'void_reason' => $event->void_reason,
            'voided_by' => $event->voidedBy !== null
                ? ['id' => $event->voidedBy->id, 'name' => $event->voidedBy->name]
                : null,
        ];
    }

    private function beneficiaryHasCoordinates(Beneficiary $owner): bool
    {
        return $owner->latitude !== null
            && $owner->longitude !== null
            && ! ((float) $owner->latitude === 0.0 && (float) $owner->longitude === 0.0);
    }

    private function barangayName(Beneficiary $owner): ?string
    {
        return $owner->barangay?->name ?? ($owner->address !== '' ? $owner->address : null);
    }

    /** @return array{0: float, 1: float}|null */
    private function barangayCenter(Beneficiary $owner): ?array
    {
        $barangay = $owner->barangay;

        if ($barangay !== null && $barangay->latitude !== null && $barangay->longitude !== null) {
            return [(float) $barangay->latitude, (float) $barangay->longitude];
        }

        $center = $owner->address !== ''
            ? Barangays::centerFor(Barangays::normalize($owner->address))
            : null;

        return $center === null ? null : [(float) $center[0], (float) $center[1]];
    }

    /** One audit row per call, carrying the from/to/date the change moved. */
    private function recordAudit(User $actor, string $action, Animal $animal, AnimalOwnershipEvent $event): void
    {
        $this->audit->log($actor, $action, $event, [
            'animal_id' => $animal->id,
            'ear_tag_number' => $animal->ear_tag_number,
            'event_type' => $event->event_type,
            'from_beneficiary_id' => $event->from_beneficiary_id,
            'to_beneficiary_id' => $event->to_beneficiary_id,
            'event_date' => $event->event_date?->toDateString(),
        ]);
    }

    /**
     * In-system notifications, written once per event to the technicians
     * assigned to the old and new holders and to every admin (minus the actor,
     * who already knows). The stored-event path is used because there is no
     * record to re-derive these from.
     */
    private function notify(
        User $actor,
        Animal $animal,
        AnimalOwnershipEvent $event,
        ?Beneficiary $from,
        ?Beneficiary $to,
    ): void {
        [$type, $title, $message] = $this->describeEvent($actor, $animal, $event, $from, $to);

        $recipientIds = collect([$from?->technician_id, $to?->technician_id])
            ->merge(User::query()->where('role', 'admin')->pluck('id'))
            ->filter()
            ->map(fn ($id): int => (int) $id)
            ->reject(fn (int $id): bool => $id === (int) $actor->id)
            ->unique()
            ->values();

        if ($recipientIds->isEmpty()) {
            return;
        }

        $notifications = app(NotificationService::class);

        foreach (User::query()->whereIn('id', $recipientIds)->get() as $recipient) {
            $notifications->create($recipient, [
                'type' => $type,
                'actor_id' => $actor->id,
                'beneficiary_id' => $to?->id,
                'title' => $title,
                'message' => $message,
                'link' => '/dashboard/dispersal-map',
            ]);
        }
    }

    /**
     * The notification type/title/message for one event, worded from the
     * record's point of view (never "you received") so the same alert reads
     * correctly for an admin as for the assigned technician.
     *
     * @return array{0: string, 1: string, 2: string}
     */
    private function describeEvent(
        User $actor,
        Animal $animal,
        AnimalOwnershipEvent $event,
        ?Beneficiary $from,
        ?Beneficiary $to,
    ): array {
        $label = $animal->ear_tag_number !== null
            ? "animal {$animal->ear_tag_number}"
            : "animal #{$animal->id}";

        if ($event->isVoided()) {
            return [
                UserNotification::TYPE_ANIMAL_EVENT_VOIDED,
                'Ownership event voided',
                "{$actor->name} voided a {$event->typeLabel()} event on {$label}.",
            ];
        }

        return match ($event->event_type) {
            AnimalOwnershipEvent::TYPE_RE_DISPERSAL => [
                UserNotification::TYPE_ANIMAL_RE_DISPERSED,
                'Animal re-dispersed',
                "{$actor->name} re-dispersed {$label} from {$from?->name_of_farmer} to {$to?->name_of_farmer}.",
            ],
            AnimalOwnershipEvent::TYPE_PASS_ON => [
                UserNotification::TYPE_ANIMAL_DISPERSED,
                'Animal passed on',
                "{$actor->name} passed on an offspring of {$label} to {$to?->name_of_farmer}.",
            ],
            AnimalOwnershipEvent::TYPE_RETURN => [
                UserNotification::TYPE_ANIMAL_RETURNED,
                'Animal returned to CVO',
                "{$actor->name} recorded {$label} returned by {$from?->name_of_farmer}.",
            ],
            default => [
                UserNotification::TYPE_ANIMAL_DISPERSED,
                'Animal dispersed',
                "{$actor->name} dispersed {$label} to {$to?->name_of_farmer}.",
            ],
        };
    }
}
