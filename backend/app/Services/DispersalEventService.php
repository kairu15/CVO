<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class DispersalEventService
{
    /** Must match StoreDispersalEventRequest::SIGNATURE_PREFIX. */
    private const SIGNATURE_PREFIX = 'data:image/png;base64,';

    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Role-scoped dispersal events, newest first. Scoping mirrors the
     * beneficiary rules so the API can never leak another technician's or
     * farmer's chain.
     */
    public function listFor(User $user): LengthAwarePaginator
    {
        return $this->scopeQueryFor($user)
            ->with(['beneficiary', 'parentBeneficiary', 'newBeneficiary'])
            ->latest('date_dispersed')
            ->latest('id')
            ->paginate(15);
    }

    /**
     * The role-scoped base query, reusing the beneficiary scoping: an event is
     * visible when any beneficiary it touches is visible to this user.
     */
    public function scopeQueryFor(User $user): Builder
    {
        $beneficiaryIds = $this->beneficiaries->scopeQueryFor($user)->select('id');

        return DispersalEvent::query()->where(function (Builder $q) use ($beneficiaryIds): void {
            $q->whereIn('beneficiary_id', $beneficiaryIds)
                ->orWhereIn('parent_beneficiary_id', $beneficiaryIds)
                ->orWhereIn('new_beneficiary_id', $beneficiaryIds);
        });
    }

    /**
     * Record a dispersal.
     *
     * Column semantics (also documented on the model):
     * - `beneficiary_id` — the household that RECEIVED the animal; the row's
     *   subject and the anchor of role scoping.
     * - `parent_beneficiary_id` — for re-dispersals, the household whose
     *   animal produced the offspring (null on initial dispersals).
     * - `new_beneficiary_id` — set when the recipient household was registered
     *   inline at re-dispersal time (equals beneficiary_id in that case).
     *
     * When `register_new` is set, the recipient household is created inline
     * first, so a field re-dispersal is one atomic action.
     */
    public function create(User $actor, array $data): DispersalEvent
    {
        return DB::transaction(function () use ($actor, $data): DispersalEvent {
            $recipientId = $data['beneficiary_id'];

            if (! empty($data['register_new'])) {
                $recipient = Beneficiary::create([
                    'farmer_id' => $data['new_farmer_id'] ?? null,
                    'name_of_farmer' => $data['new_name_of_farmer'],
                    'address' => $data['new_address'],
                    'animal_type' => $data['new_animal_type'],
                    'sex' => $data['new_sex'],
                    'latitude' => $data['new_latitude'] ?? null,
                    'longitude' => $data['new_longitude'] ?? null,
                    'technician_id' => $actor->role === 'technician' ? $actor->id : null,
                ]);

                $recipientId = $recipient->id;
            }

            $event = DispersalEvent::create([
                'beneficiary_id' => $recipientId,
                'parent_beneficiary_id' => $data['parent_beneficiary_id'] ?? null,
                'new_beneficiary_id' => $recipientId,
                'dispersal_type' => $data['dispersal_type'],
                'date_dispersed' => $data['date_dispersed'] ?? null,
                'remarks' => $data['remarks'] ?? null,
            ]);

            // The signature is captured at the same moment as the dispersal
            // and is part of the same atomic action: either the agreement and
            // its event both exist, or neither does. "Who" is always the
            // authenticated actor — never a client-supplied id.
            if (! empty($data['signature'])) {
                $event->update([
                    'signature_path' => $this->storeSignature($data['signature']),
                    'signature_captured_by' => $actor->id,
                    'signature_captured_at' => $data['signature_captured_at'] ?? now(),
                ]);
            }

            $this->audit->log($actor, 'dispersal_created', $event);

            return $event;
        });
    }

    /**
     * Decode a PNG data-URL signature and store it on the private `secure`
     * disk under a server-generated name — the client's name is never used,
     * mirroring ImageSanitizer for uploaded photos.
     *
     * Validation (StoreDispersalEventRequest) has already proven the payload
     * is a base64 PNG, so a malformed value here can only come from a caller
     * bypassing the request — guard anyway rather than write a broken file.
     */
    private function storeSignature(string $dataUrl): string
    {
        $binary = base64_decode(substr($dataUrl, strlen(self::SIGNATURE_PREFIX)), true);

        if ($binary === false) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'signature' => 'The signature image could not be read. Please sign again.',
            ]);
        }

        $path = 'dispersal-signatures/'.strtolower(Str::random(40)).'.png';

        Storage::disk('secure')->put($path, $binary);

        return $path;
    }

    /**
     * The pass-on chain around one beneficiary.
     *
     * `chain` walks backwards from the beneficiary's own delivery event to
     * the chain root (oldest first) — the lineage of where the animal came
     * from. `descendant_events` are the re-dispersals recorded against this
     * beneficiary as the parent source (where its offspring went). The
     * backwards walk is cycle-safe: every beneficiary is delivered-to at
     * most once, so each event can appear only once, and a visited guard
     * protects against corrupted data.
     *
     * Returns null only when the beneficiary is not visible to this user
     * (missing or out of scope — the controller answers 404). A beneficiary
     * with no dispersal record yet is a normal state, answered with an
     * empty chain so the client can show its "no dispersal recorded"
     * empty state instead of an error.
     *
     * @return array{chain: list<array<string, mixed>>, events: list<DispersalEvent>, descendant_events: list<array<string, mixed>>, descendant_tree: list<array<string, mixed>>, current: Beneficiary}|null
     */
    public function lineageFor(User $user, int $beneficiaryId): ?array
    {
        $current = $this->beneficiaries->scopeQueryFor($user)
            ->with(['technician', 'farmer'])
            ->find($beneficiaryId);

        if (! $current) {
            return null;
        }

        // The event that delivered an animal to this beneficiary: an initial
        // dispersal, or a re-dispersal that received the offspring.
        // The offspring subtree is independent of how this household received
        // its animal, so it is built first: a household registered by import
        // can still have passed offspring on without a recorded delivery.
        $descendantTree = $this->descendantTreeFor($beneficiaryId);

        $entry = $this->deliveryEventFor($beneficiaryId);

        if (! $entry) {
            // Registered, visible, but staff have not recorded the dispersal
            // that delivered its animal — empty chain, not an error.
            return [
                'chain' => [],
                'events' => [],
                'descendant_events' => [],
                'descendant_tree' => $descendantTree,
                'current' => $current,
            ];
        }

        // Walk backwards to the root: follow the parent beneficiary's own
        // delivery event until an initial dispersal is reached.
        $events = collect([$entry]);
        $visited = collect([$entry->id]);
        $guard = 0;

        while ($guard++ < 100) {
            $cursor = $events->last();

            if ($cursor->dispersal_type !== DispersalEvent::TYPE_RE_DISPERSAL) {
                break; // reached the initial dispersal — the root
            }

            $parentEvent = $this->deliveryEventFor($cursor->parent_beneficiary_id);

            if (! $parentEvent || $visited->contains($parentEvent->id)) {
                break; // parent has no recorded chain, or corrupted cycle
            }

            $visited->push($parentEvent->id);
            $events->push($parentEvent);
        }

        $events = $events->reverse()->values(); // oldest link first

        // Forward hops: offspring of this household's animal passed on to
        // other beneficiaries, newest first.
        $descendants = DispersalEvent::query()
            ->where('dispersal_type', DispersalEvent::TYPE_RE_DISPERSAL)
            ->where('parent_beneficiary_id', $beneficiaryId)
            ->with(['beneficiary', 'newBeneficiary'])
            ->orderByDesc('date_dispersed')
            ->orderByDesc('id')
            ->get()
            ->map(fn (DispersalEvent $event) => [
                'event_id' => $event->id,
                'beneficiary_id' => $event->beneficiary_id,
                'parent_beneficiary_id' => $event->parent_beneficiary_id,
                'name_of_farmer' => $event->beneficiary->name_of_farmer,
                'address' => $event->beneficiary->address,
                'animal_type' => $event->beneficiary->animal_type,
                'latitude' => $event->beneficiary->latitude,
                'longitude' => $event->beneficiary->longitude,
                'date_dispersed' => $event->date_dispersed?->toDateString(),
                'remarks' => $event->remarks,
            ])
            ->values()
            ->all();

        $chain = $events
            ->map(fn (DispersalEvent $event) => [
                'event_id' => $event->id,
                'beneficiary_id' => $event->beneficiary_id,
                'name_of_farmer' => $event->beneficiary->name_of_farmer,
                'address' => $event->beneficiary->address,
                'animal_type' => $event->beneficiary->animal_type,
                'latitude' => $event->beneficiary->latitude,
                'longitude' => $event->beneficiary->longitude,
                'date_dispersed' => $event->date_dispersed?->toDateString(),
                'dispersal_type' => $event->dispersal_type,
                'is_current' => $event->beneficiary_id === $beneficiaryId,
            ])
            ->values()
            ->all();

        return [
            'chain' => $chain,
            'events' => $events->all(),
            'descendant_events' => $descendants,
            'descendant_tree' => $descendantTree,
            'current' => $current,
        ];
    }

    /**
     * The multi-generation offspring tree rooted at one beneficiary.
     *
     * Each node is an offspring household (a re-dispersal whose parent is the
     * node above it), so the shape mirrors the pass-on programme: the original
     * household at the root, its offspring below it, and their offspring below
     * those. This is what walks past the one-level `descendant_events` list.
     *
     * Like `chain` and `descendant_events`, this is chain-wide: authorization
     * is decided by whether the caller can view the ANCHOR beneficiary (see
     * lineageFor), after which the animal's whole recorded line — including
     * households outside the caller's own scope — is shown. That is the point
     * of a lineage view (a farmer seeing where their animal's offspring went),
     * so the tree deliberately does not re-scope per node. A visited set and a
     * depth cap protect against corrupted data (a cycle would otherwise
     * recurse forever).
     *
     * @return list<array<string, mixed>>
     */
    private function descendantTreeFor(int $rootId): array
    {
        return $this->descendantsOf($rootId, [$rootId => true], 1);
    }

    /**
     * One generation's children, recursing into each child's own offspring.
     *
     * @param  array<int, bool>  $visited  beneficiary ids already placed (cycle guard)
     * @return list<array<string, mixed>>
     */
    private function descendantsOf(int $parentId, array $visited, int $generation): array
    {
        if ($generation > 25) {
            return []; // depth cap: corrupted data must not recurse forever
        }

        $events = DispersalEvent::query()
            ->where('dispersal_type', DispersalEvent::TYPE_RE_DISPERSAL)
            ->where('parent_beneficiary_id', $parentId)
            ->with('beneficiary')
            ->orderBy('date_dispersed')
            ->orderBy('id')
            ->get();

        $nodes = [];

        foreach ($events as $event) {
            $childId = $event->beneficiary_id;

            if (isset($visited[$childId])) {
                continue; // already placed on this branch (corrupted data)
            }

            $visited[$childId] = true;

            $nodes[] = [
                'event_id' => $event->id,
                'beneficiary_id' => $childId,
                'parent_beneficiary_id' => $event->parent_beneficiary_id,
                'name_of_farmer' => $event->beneficiary->name_of_farmer,
                'address' => $event->beneficiary->address,
                'animal_type' => $event->beneficiary->animal_type,
                'sex' => $event->beneficiary->sex,
                'date_dispersed' => $event->date_dispersed?->toDateString(),
                'remarks' => $event->remarks,
                'generation' => $generation,
                'children' => $this->descendantsOf($childId, $visited, $generation + 1),
            ];
        }

        return $nodes;
    }

    /**
     * The event that delivered an animal to the given beneficiary — an
     * initial dispersal naming it, or a re-dispersal it received.
     */
    private function deliveryEventFor(?int $beneficiaryId): ?DispersalEvent
    {
        if ($beneficiaryId === null) {
            return null;
        }

        return DispersalEvent::query()
            ->where(function (Builder $q) use ($beneficiaryId): void {
                $q->where('dispersal_type', DispersalEvent::TYPE_INITIAL)
                    ->where('beneficiary_id', $beneficiaryId);
            })->orWhere(function (Builder $q) use ($beneficiaryId): void {
                $q->where('dispersal_type', DispersalEvent::TYPE_RE_DISPERSAL)
                    ->where('beneficiary_id', $beneficiaryId);
            })
            ->with(['beneficiary', 'parentBeneficiary'])
            ->orderBy('dispersal_type') // prefer 'initial' when both exist
            ->first();
    }
}
