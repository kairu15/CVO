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
        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return true;
        }

        if ($user->role === 'technician') {
            return $record->beneficiary->technician_id === $user->id;
        }

        return $record->beneficiary->farmer_id === $user->id;
    }

    /**
     * Only technicians log monitoring visits.
     */
    public function create(User $user): bool
    {
        return $user->role === 'technician';
    }

    /**
     * Technicians edit their own entries; doctor and admin have oversight.
     */
    public function update(User $user, MonitoringRecord $record): bool
    {
        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return true;
        }

        return $user->role === 'technician' && $record->technician_id === $user->id;
    }

    public function delete(User $user, MonitoringRecord $record): bool
    {
        return $user->role === 'admin'
            || ($user->role === 'technician' && $record->technician_id === $user->id);
    }
}
