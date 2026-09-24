<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\User;
use Database\Factories\BeneficiaryFactory;
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

    public function assignTechnician(Beneficiary $beneficiary, ?int $technicianId): Beneficiary
    {
        $beneficiary->update(['technician_id' => $technicianId]);

        return $beneficiary->refresh();
    }
}
