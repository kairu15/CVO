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
     * technician: all beneficiaries (field work plus the clinical
     * record-keeping the old doctor role carried).
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

        return in_array($user->role, ['admin', 'technician'], true);
    }

    /**
     * Staff enrol beneficiaries from the admin Beneficiaries screen.
     */
    public function create(User $user): bool
    {
        return $user->hasPermission('beneficiaries.create');
    }

    /**
     * Correcting a beneficiary's details is an admin action: it is the
     * program's own record, not something an account owns.
     */
    public function update(User $user, Beneficiary $beneficiary): bool
    {
        return $user->hasPermission('beneficiaries.update');
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
