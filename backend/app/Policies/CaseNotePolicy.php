<?php

namespace App\Policies;

use App\Models\CaseNote;
use App\Models\User;

/**
 * Authorization for case notes.
 *
 * Mirrors HealthRecordPolicy deliberately: both are technician-authored
 * records about one animal, so the same people may read them and the same
 * person may change them. Row-level scoping is applied at the query level by
 * CaseNoteService; this guards single-record fetches and writes.
 */
class CaseNotePolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('case_notes.view');
    }

    public function view(User $user, CaseNote $note): bool
    {
        if (! $user->hasPermission('case_notes.view')) {
            return false;
        }

        return in_array($user->role, ['admin', 'technician'], true);
    }

    /**
     * Only the technician — the system's clinical author — writes a case note.
     */
    public function create(User $user): bool
    {
        return $user->hasPermission('case_notes.create');
    }

    /**
     * The author keeps control of their own note; the administrator can step
     * in once a technician has left. A colleague cannot rewrite someone
     * else's observations — an author is part of what a note means.
     */
    public function update(User $user, CaseNote $note): bool
    {
        if (! $user->hasPermission('case_notes.update')) {
            return false;
        }

        return $user->role === 'admin'
            || ($user->role === 'technician' && $note->doctor_id === $user->id);
    }

    public function delete(User $user, CaseNote $note): bool
    {
        return $this->update($user, $note);
    }
}
