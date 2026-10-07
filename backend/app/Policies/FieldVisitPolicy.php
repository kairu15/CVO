<?php

namespace App\Policies;

use App\Models\FieldVisit;
use App\Models\User;

/**
 * Authorization for field visits.
 *
 * Scoping here is by VISITING TECHNICIAN, not by assigned beneficiary — unlike
 * monitoring and health records. A visit is the technician's own activity log,
 * so "my visits" is the meaningful slice for that role. Farmers see the visits
 * made to their animals, and admin/doctor see everything for oversight.
 */
class FieldVisitPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('field_visits.view');
    }

    public function view(User $user, FieldVisit $visit): bool
    {
        if (! $user->hasPermission('field_visits.view')) {
            return false;
        }

        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return true;
        }

        if ($user->role === 'technician') {
            return $visit->technician_id === $user->id;
        }

        return $visit->beneficiary->farmer_id === $user->id;
    }

    /**
     * Only a field technician logs a trip.
     */
    public function create(User $user): bool
    {
        return $user->hasPermission('field_visits.create');
    }

    /**
     * The technician who made the trip owns its record; an administrator can
     * step in once they have left.
     */
    public function update(User $user, FieldVisit $visit): bool
    {
        if (! $user->hasPermission('field_visits.update')) {
            return false;
        }

        return $user->role === 'admin'
            || ($user->role === 'technician' && $visit->technician_id === $user->id);
    }

    public function delete(User $user, FieldVisit $visit): bool
    {
        return $this->update($user, $visit);
    }
}
