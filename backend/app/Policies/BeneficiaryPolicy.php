<?php

namespace App\Policies;

use App\Models\Beneficiary;
use App\Models\User;

class BeneficiaryPolicy
{
    /**
     * Capability gates come from the role_permissions matrix
     * ($user->hasPermission); the row-scope rules below stay role-driven, so
     * granting a capability to a role the scope rules never reach is inert.
     */

    /**
     * admin: all beneficiaries (program oversight).
     * doctor: all beneficiaries (health oversight).
     * technician: only beneficiaries assigned to them.
     * farmer: only their own beneficiaries.
     */
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('beneficiaries.view');
    }

    public function view(User $user, Beneficiary $beneficiary): bool
    {
        if (! $user->hasPermission('beneficiaries.view')) {
            return false;
        }

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
        return $user->hasPermission('beneficiaries.create');
    }

    /**
     * Farmers keep their own beneficiary details accurate; admin fixes the rest.
     */
    public function update(User $user, Beneficiary $beneficiary): bool
    {
        if (! $user->hasPermission('beneficiaries.update')) {
            return false;
        }

        if ($user->role === 'admin') {
            return true;
        }

        return $user->role === 'farmer' && $beneficiary->farmer_id === $user->id;
    }

    public function delete(User $user, Beneficiary $beneficiary): bool
    {
        return $user->hasPermission('beneficiaries.delete');
    }

    /**
     * Admin-only: attach/detach a technician.
     */
    public function assignTechnician(User $user): bool
    {
        return $user->hasPermission('assign_technicians');
    }
}
