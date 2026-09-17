<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class BeneficiaryService
{
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

        return Beneficiary::create([
            ...$data,
            'farmer_id' => $farmerId,
        ]);
    }

    public function assignTechnician(Beneficiary $beneficiary, ?int $technicianId): Beneficiary
    {
        $beneficiary->update(['technician_id' => $technicianId]);

        return $beneficiary->refresh();
    }
}
