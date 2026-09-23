<?php

namespace App\Policies;

use App\Models\CaseNote;
use App\Models\User;

/**
 * Authorization for case notes.
 *
 * Mirrors HealthRecordPolicy deliberately: both are veterinarian-authored
 * records about one animal, so the same people may read them and the same
 * person may change them. Row-level scoping is applied at the query level by
 * CaseNoteService; this guards single-record fetches and writes.
 */
class CaseNotePolicy
{
    public function viewAny(User $user): bool
    {
        return in_array($user->role, User::ROLES, true);
    }

    public function view(User $user, CaseNote $note): bool
    {
        if (in_array($user->role, ['admin', 'doctor'], true)) {
            return true;
        }

        if ($user->role === 'technician') {
            return $note->beneficiary->technician_id === $user->id;
        }

        return $note->beneficiary->farmer_id === $user->id;
    }

    /**
     * Only a veterinarian writes a case note.
     */
    public function create(User $user): bool
    {
        return $user->role === 'doctor';
    }

    /**
     * The author keeps control of their own note; the administrator can step
     * in once a vet has left. A colleague cannot rewrite someone else's
     * observations — an author is part of what a note means.
     */
    public function update(User $user, CaseNote $note): bool
    {
        return $user->role === 'admin'
            || ($user->role === 'doctor' && $note->doctor_id === $user->id);
    }

    public function delete(User $user, CaseNote $note): bool
    {
        return $this->update($user, $note);
    }
}
