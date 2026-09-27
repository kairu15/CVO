<?php

namespace App\Services;

use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Validation\ValidationException;

/**
 * Role assignment for accounts.
 *
 * Role changes are the only way an administrator can be created or removed —
 * self-registration always produces a farmer and there is no delete-account
 * endpoint — so this is the one place that can strand the system without an
 * administrator, and the guard belongs here rather than only in the SPA.
 */
class UserRoleService
{
    public function __construct(private readonly AuditLogger $audit) {}
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

        $previous = $target->role;

        $target->update(['role' => $role]);

        // Role changes are the highest-value audit event in the system (item
        // 7): they are how accounts gain or lose staff access, so both the
        // old and the new role are on the row.
        $this->audit->log($actor, 'role_changed', $target, [
            'previous_role' => $previous,
            'new_role' => $role,
        ]);

        return $target->refresh();
    }
}
