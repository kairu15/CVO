<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\TechnicianAssignment;
use App\Models\User;
use App\Models\UserNotification;
use Database\Factories\BeneficiaryFactory;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class BeneficiaryService
{
    public function __construct(private readonly GeocodingService $geocoder) {}

    /**
     * Role-scoped beneficiary list.
     *
     * admin/doctor: everything. technician: only assigned beneficiaries.
     * farmer: only their own. The scoping is applied at the query level so
     * the API can never leak rows the client merely failed to filter.
     */
    public function listFor(User $user): LengthAwarePaginator
    {
        return $this->scopeQueryFor($user)
            ->with(['technician', 'farmer'])
            ->withCount('monitoringRecords')
            ->latest()
            ->paginate(15);
    }

    /**
     * The same role scoping as a reusable query — MonitoringRecordService
     * applies it through the beneficiary relationship.
     *
     * A technician's visibility is their ACTIVE assignments (the
     * beneficiaries.technician_id column, one active technician per
     * beneficiary). History lives in the technician_assignments audit
     * table and never grants access.
     */
    public function scopeQueryFor(User $user): Builder
    {
        $query = Beneficiary::query();

        return match ($user->role) {
            'admin', 'doctor' => $query,
            'technician' => $query->where('technician_id', $user->id),
            default => $query->where('farmer_id', $user->id),
        };
    }

    /**
     * Fetch ONE beneficiary with role-appropriate failure modes.
     *
     * admin/doctor/farmer: a record outside their scope is simply not found
     * for them — 404, exactly as before. A TECHNICIAN pointing at a
     * beneficiary they are not assigned to is a permissions boundary, not a
     * missing row, so it answers 403 — a silent 404 there would read as a
     * bug rather than an access rule.
     *
     * @throws \Illuminate\Database\Eloquent\ModelNotFoundException
     * @throws AuthorizationException
     */
    public function findFor(User $user, int $beneficiaryId): Beneficiary
    {
        $beneficiary = $this->scopeQueryFor($user)->find($beneficiaryId);

        if ($beneficiary) {
            return $beneficiary;
        }

        if ($user->role === 'technician'
            && Beneficiary::query()->whereKey($beneficiaryId)->exists()) {
            throw new AuthorizationException('This farmer is not assigned to you.');
        }

        // Genuinely missing (or out of scope for a non-technician role).
        abort(404);
    }

    /**
     * Assign (or clear) the active technician on a beneficiary and append
     * the change to the audit trail.
     *
     * The active assignment is the single source of truth for scoping (the
     * beneficiaries.technician_id column); history rows in
     * technician_assignments exist for accountability only and never grant
     * access.
     */
    public function assignTechnician(Beneficiary $beneficiary, ?int $technicianId, User $actor): Beneficiary
    {
        $previous = $beneficiary->technician_id;

        $beneficiary->update(['technician_id' => $technicianId]);

        TechnicianAssignment::create([
            'beneficiary_id' => $beneficiary->id,
            'technician_id' => $technicianId,
            'assigned_by' => $actor->id,
            'assigned_at' => now(),
            'previous_technician_id' => $previous,
        ]);

        // Notify the technician gaining (or losing) the household, and the
        // farmer whose animal it is. A reassignment is one event with two
        // sides: the new technician needs to know they are on, the old one
        // that they are off.
        //
        // Resolved lazily: NotificationService depends on the vaccination /
        // dispersal services, which depend on THIS service — a constructor
        // injection here would be a resolution cycle. At call time the
        // graph is already built, so the container hands it over fine.
        $notifications = app(NotificationService::class);

        $isReassignment = $previous !== null && $technicianId !== null && $previous !== $technicianId;
        $type = $isReassignment
            ? UserNotification::TYPE_TECHNICIAN_REASSIGNED
            : UserNotification::TYPE_TECHNICIAN_ASSIGNED;
        $household = "{$beneficiary->name_of_farmer} in {$beneficiary->address}";

        if ($technicianId !== null) {
            $technician = User::find($technicianId);

            if ($technician) {
                $notifications->create($technician, [
                    'type' => $type,
                    'actor_id' => $actor->id,
                    'beneficiary_id' => $beneficiary->id,
                    'title' => $isReassignment ? 'Farmer reassigned to you' : 'Farmer assigned to you',
                    'message' => "{$actor->name} assigned {$household} to you.",
                    'link' => '/dashboard/technician/monitoring',
                ]);
            }
        }

        // The outgoing technician only hears about it on a reassignment.
        if ($isReassignment) {
            $outgoing = User::find($previous);

            if ($outgoing) {
                $notifications->create($outgoing, [
                    'type' => $type,
                    'actor_id' => $actor->id,
                    'beneficiary_id' => $beneficiary->id,
                    'title' => 'Farmer reassigned away from you',
                    'message' => "{$actor->name} reassigned {$household} to another technician.",
                    'link' => '/dashboard/technician/monitoring',
                ]);
            }
        }

        if ($beneficiary->farmer_id !== null) {
            $farmer = User::find($beneficiary->farmer_id);

            if ($farmer && $technicianId !== null) {
                $technician = User::find($technicianId);
                $notifications->create($farmer, [
                    'type' => $type,
                    'actor_id' => $actor->id,
                    'beneficiary_id' => $beneficiary->id,
                    'title' => 'Your technician was updated',
                    'message' => $technician
                        ? "{$technician->name} is now the technician monitoring {$household}."
                        : "A technician was assigned to {$household}.",
                    'link' => '/dashboard/farmer/monitoring',
                ]);
            }
        }

        return $beneficiary->refresh();
    }

    public function create(User $actor, array $data): Beneficiary
    {
        // Farmers create their own records; staff may register on behalf of a
        // farmer via farmer_id (validated to hold the farmer role).
        $farmerId = $data['farmer_id'] ?? null;

        if ($actor->role === 'farmer') {
            $farmerId = $actor->id;
        }

        $farmerId ??= $actor->id;

        // No pin captured in the field? Resolve the address to real
        // coordinates so the dispersal map shows it in the right place.
        if (! isset($data['latitude'], $data['longitude'])) {
            $geo = $this->geocodeFor($data['address'] ?? null);

            $data['latitude'] = $geo['lat'] ?? null;
            $data['longitude'] = $geo['lng'] ?? null;
        }

        return Beneficiary::create([
            ...$data,
            'farmer_id' => $farmerId,
        ]);
    }

    /**
     * Resolve a beneficiary address to coordinates (city-scoped), or null.
     *
     * @return array{lat: float, lng: float, display_name: string}|null
     */
    public function geocodeFor(?string $address): ?array
    {
        if (! $address) {
            return null;
        }

        $hit = $this->geocoder->geocode($address, 'Bayawan, Philippines');

        if ($hit) {
            return ['lat' => $hit['lat'], 'lng' => $hit['lng'], 'display_name' => $hit['display_name']];
        }

        // OSM doesn't index every local barangay name — fall back to the
        // authoritative barangay center so the pin still lands in the right
        // barangay instead of nowhere (or in the wrong province).
        $centroid = BeneficiaryFactory::BARANGAY_COORDS()[$address] ?? null;

        if ($centroid) {
            return [
                'lat' => $centroid[0],
                'lng' => $centroid[1],
                'display_name' => "{$address}, Bayawan City, Negros Oriental (barangay centroid)",
            ];
        }

        return null;
    }


}
