<?php

namespace App\Policies;

use App\Models\Beneficiary;
use App\Models\User;

class BeneficiaryPolicy
{
    /**
     * admin: all beneficiaries (program oversight).
     * doctor: all beneficiaries (health oversight).
     * technician: only beneficiaries assigned to them.
     * farmer: only their own beneficiaries.
     */
    public function viewAny(User $user): bool
    {
        return in_array($user->role, ['admin', 'doctor', 'technician', 'farmer'], true);
    }

    public function view(User $user, Beneficiary $beneficiary): bool
    {
        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return true;
        }

        if ($user->role === 'technician') {
            return $beneficiary->technician_id === $user->id;
        }

        return $beneficiary->farmer_id === $user->id;
    }

    /**
     * Farmers create their own beneficiary records (registration flow);
     * staff may register on behalf of a farmer.
     */
    public function create(User $user): bool
    {
        return in_array($user->role, ['admin', 'technician', 'farmer'], true);
    }

    /**
     * Farmers keep their own beneficiary details accurate; admin fixes the rest.
     */
    public function update(User $user, Beneficiary $beneficiary): bool
    {
        if ($user->role === 'admin') {
            return true;
        }

        return $user->role === 'farmer' && $beneficiary->farmer_id === $user->id;
    }

    public function delete(User $user, Beneficiary $beneficiary): bool
    {
        return $user->role === 'admin';
    }

    /**
     * Admin-only: attach/detach a technician.
     */
    public function assignTechnician(User $user): bool
    {
        return $user->role === 'admin';
    }
}
