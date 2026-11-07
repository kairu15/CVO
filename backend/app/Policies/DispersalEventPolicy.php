<?php

namespace App\Policies;

use App\Models\DispersalEvent;
use App\Models\User;

class DispersalEventPolicy
{
    /**
     * Mirrors the beneficiary scoping: admin and technicians have program-wide
     * oversight (the technician absorbed the old doctor role's health/chain
     * oversight).
     */
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('dispersals.view');
    }

    public function view(User $user, DispersalEvent $event): bool
    {
        if (! $user->hasPermission('dispersals.view')) {
            return false;
        }

        return in_array($user->role, ['admin', 'technician'], true);
    }

    /**
     * Technicians record dispersals in the field (including re-dispersals);
     * admin may backfill records. Scope enforcement ("assigned") happens in
     * the FormRequest's scoped exists rules, mirroring the BeneficiaryPolicy
     * pattern.
     */
    public function create(User $user): bool
    {
        return $user->hasPermission('dispersals.create');
    }

    public function update(User $user, DispersalEvent $event): bool
    {
        if (! $user->hasPermission('dispersals.update')) {
            return false;
        }

        if ($user->role === 'admin') {
            return true;
        }

        return $user->role === 'technician'
            && $event->beneficiary->technician_id === $user->id;
    }

    public function delete(User $user, DispersalEvent $event): bool
    {
        if (! $user->hasPermission('dispersals.delete')) {
            return false;
        }

        return $user->role === 'admin'
            || ($user->role === 'technician'
                && $event->beneficiary->technician_id === $user->id);
    }
}
