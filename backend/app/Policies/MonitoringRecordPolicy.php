<?php

namespace App\Policies;

use App\Models\MonitoringRecord;
use App\Models\User;

class MonitoringRecordPolicy
{
    /**
     * Scoping happens at the query level (BeneficiaryPolicy scoping applied to
     * the beneficiary relationship); this guards single-record fetches.
     */
    public function view(User $user, MonitoringRecord $record): bool
    {
        if (! $user->hasPermission('monitoring.view')) {
            return false;
        }

        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return true;
        }

        return $user->role === 'technician' && $record->beneficiary->technician_id === $user->id;
    }

    /**
     * Only technicians log monitoring visits.
     */
    public function create(User $user): bool
    {
        return $user->hasPermission('monitoring.create');
    }

    /**
     * Technicians edit their own entries; doctor and admin have oversight.
     */
    public function update(User $user, MonitoringRecord $record): bool
    {
        if (! $user->hasPermission('monitoring.update')) {
            return false;
        }

        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return true;
        }

        return $user->role === 'technician' && $record->technician_id === $user->id;
    }

    public function delete(User $user, MonitoringRecord $record): bool
    {
        if (! $user->hasPermission('monitoring.delete')) {
            return false;
        }

        return $user->role === 'admin'
            || ($user->role === 'technician' && $record->technician_id === $user->id);
    }

    /**
     * Setting the dispersal's MOA status is an admin-oversight action, gated
     * on its own capability (seeded admin-only) rather than `monitoring.update`
     * — doctors and technicians may edit monitoring records, but signing off
     * on the program agreement is not their call. Expressing it as a
     * capability keeps the boundary visible and adjustable on the Roles &
     * Permissions screen.
     */
    public function setMoa(User $user, MonitoringRecord $record): bool
    {
        return $user->hasPermission('monitoring.set-moa');
    }
}
