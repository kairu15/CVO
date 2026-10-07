<?php

namespace App\Policies;

use App\Models\HealthRecord;
use App\Models\User;

/**
 * Authorization for clinical health records.
 *
 * Row-level scoping (which records a user may even see) is applied at the query
 * level by HealthRecordService; this guards single-record fetches and writes.
 */
class HealthRecordPolicy
{
    /**
     * Everyone with an account may reach the health records screen; the rows
     * they receive are limited by the service's role scoping.
     */
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('health_records.view');
    }

    public function view(User $user, HealthRecord $record): bool
    {
        if (! $user->hasPermission('health_records.view')) {
            return false;
        }

        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return true;
        }

        if ($user->role === 'technician') {
            return $record->beneficiary->technician_id === $user->id;
        }

        return $record->beneficiary->farmer_id === $user->id;
    }

    /**
     * Only a veterinarian writes a clinical diagnosis.
     */
    public function create(User $user): bool
    {
        return $user->hasPermission('health_records.create');
    }

    /**
     * The authoring veterinarian keeps control of their own diagnosis; the
     * administrator can step in (records must stay correctable after a vet
     * leaves). Other vets cannot rewrite a colleague's clinical judgement —
     * this is intentionally stricter than MonitoringRecordPolicy, where any
     * doctor may correct a visit log.
     */
    public function update(User $user, HealthRecord $record): bool
    {
        if (! $user->hasPermission('health_records.update')) {
            return false;
        }

        return $user->role === 'admin'
            || ($user->role === 'doctor' && $record->doctor_id === $user->id);
    }

    public function delete(User $user, HealthRecord $record): bool
    {
        return $this->update($user, $record);
    }
}
