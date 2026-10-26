<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Role assignment for accounts.
 *
 * Role changes are the only way an administrator can be created or removed —
 * there is no delete-account endpoint — so this is the one place that can
 * strand the system without an administrator, and the guard belongs here
 * rather than only in the SPA.
 */
class UserRoleService
{
    /**
     * Set an account's role.
     *
     * An administrator may not change their own role. Without this, an admin
     * can demote themselves and lose every admin route immediately, with no
     * way back in short of editing the database by hand.
     *
     * Note on what is deliberately *not* checked: there is no separate
     * "last administrator" rule, because it would be unreachable. Only an
     * administrator can reach this endpoint (EnsureUserIsAdmin +
     * AssignRoleRequest::authorize), so a target that is the sole remaining
     * administrator could only ever be changed by that same account — which
     * the self-change check below already refuses. Demoting another admin
     * always leaves the actor as an admin.
     *
     * @throws ValidationException when the actor targets their own account.
     */
    public function assignRole(User $actor, User $target, string $role): User
    {
        if ($actor->is($target)) {
            throw ValidationException::withMessages([
                'role' => 'You cannot change your own role. Ask another administrator to do it.',
            ]);
        }

        // Role changes are the highest-value audit event in the system: they
        // are how accounts gain or lose staff access. One transaction — the
        // User model writes `role_changed` (with previous/new role) inside it,
        // so the trail and the change commit or roll back together.
        DB::transaction(fn () => $target->update(['role' => $role]));

        return $target->refresh();
    }
}
