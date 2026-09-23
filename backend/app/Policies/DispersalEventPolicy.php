<?php

namespace App\Policies;

use App\Models\DispersalEvent;
use App\Models\User;

class DispersalEventPolicy
{
    /**
     * Mirrors the beneficiary scoping: admin/doctor have program-wide
     * oversight, technicians see the chains they are assigned to, farmers
     * only their own animals.
     */
    public function viewAny(User $user): bool
    {
        return in_array($user->role, ['admin', 'doctor', 'technician', 'farmer'], true);
    }

    public function view(User $user, DispersalEvent $event): bool
    {
        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return true;
        }

        if ($user->role === 'technician') {
            return $this->touchesTechnician($event, $user->id);
        }

        return $this->touchesFarmer($event, $user->id);
    }

    /**
     * Farmers record the initial dispersal of the animal they received;
     * technicians record dispersals in the field (including re-dispersals);
     * admin may backfill records. Scope enforcement ("own"/"assigned")
     * happens in the FormRequest's scoped exists rules, mirroring the
     * BeneficiaryPolicy pattern.
     */
    public function create(User $user): bool
    {
        return in_array($user->role, ['admin', 'technician', 'farmer'], true);
    }

    public function update(User $user, DispersalEvent $event): bool
    {
        if ($user->role === 'admin') {
            return true;
        }

        return $user->role === 'technician'
            && $event->beneficiary->technician_id === $user->id;
    }

    public function delete(User $user, DispersalEvent $event): bool
    {
        return $user->role === 'admin'
            || ($user->role === 'technician'
                && $event->beneficiary->technician_id === $user->id);
    }

    /**
     * True when the technician is assigned to any beneficiary the event
     * touches (source, parent or new recipient).
     */
    private function touchesTechnician(DispersalEvent $event, int $technicianId): bool
    {
        return $event->beneficiary->technician_id === $technicianId
            || $event->parentBeneficiary?->technician_id === $technicianId
            || $event->newBeneficiary?->technician_id === $technicianId;
    }

    /**
     * True when the farmer owns any beneficiary the event touches.
     */
    private function touchesFarmer(DispersalEvent $event, int $farmerId): bool
    {
        return $event->beneficiary->farmer_id === $farmerId
            || $event->parentBeneficiary?->farmer_id === $farmerId
            || $event->newBeneficiary?->farmer_id === $farmerId;
    }
}
