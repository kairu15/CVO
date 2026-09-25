<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class DispersalEventService
{
    public function __construct(private readonly BeneficiaryService $beneficiaries) {}

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

            return DispersalEvent::create([
                'beneficiary_id' => $recipientId,
                'parent_beneficiary_id' => $data['parent_beneficiary_id'] ?? null,
                'new_beneficiary_id' => $recipientId,
                'dispersal_type' => $data['dispersal_type'],
                'date_dispersed' => $data['date_dispersed'] ?? null,
                'remarks' => $data['remarks'] ?? null,
            ]);
        });
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
     * @return array{chain: list<array<string, mixed>>, events: list<DispersalEvent>, descendant_events: list<array<string, mixed>>, current: Beneficiary}|null
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
        $entry = $this->deliveryEventFor($beneficiaryId);

        if (! $entry) {
            // Registered, visible, but staff have not recorded the dispersal
            // that delivered its animal — empty chain, not an error.
            return [
                'chain' => [],
                'events' => [],
                'descendant_events' => [],
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
            'current' => $current,
        ];
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
