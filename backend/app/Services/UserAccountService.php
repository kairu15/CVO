<?php

namespace App\Services;

use App\Models\User;
use App\Services\Auth\AuthService;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Account lifecycle for the admin User Management screen: create a staff
 * account, edit its profile, deactivate it, bring it back.
 *
 * Deactivation is the soft delete the rest of the system already uses — there
 * is deliberately no hard-delete path for accounts, because rows across the
 * database reference `users.id` (beneficiaries' technicians, authored health
 * records, audit log actors). A hard delete would either orphan or destroy
 * that history; a soft delete keeps the account resolvable while making it
 * unable to sign in.
 *
 * Two guards live here rather than only in the SPA, for the same reason
 * UserRoleService's self-change guard does: they are the difference between a
 * working system and one with no administrator in it.
 *   - an administrator cannot deactivate their own account, and
 *   - an administrator cannot change their own role (enforced by
 *     UserRoleService, which this service delegates to).
 * Together they mean the actor always remains an active admin.
 */
class UserAccountService
{
    public function __construct(
        private readonly UserRoleService $roles,
        private readonly AuthService $auth,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Create a staff account.
     *
     * Staff roles only: the request layer rejects `farmer` here. Public
     * self-registration is the farmer path (it also creates the beneficiary
     * record that monitoring auto-fills from), so manufacturing a farmer
     * account from this screen would produce an account with no dispersal
     * attached — a state the rest of the system does not expect.
     *
     * @param  array{name: string, email: string, password: string, role: string}  $attributes
     */
    public function create(User $actor, array $attributes): User
    {
        $user = DB::transaction(function () use ($actor, $attributes): User {
            // The `password` => 'hashed' cast on User hashes on assignment.
            $user = User::create([
                'name' => $attributes['name'],
                'email' => $attributes['email'],
                'password' => $attributes['password'],
                'role' => $attributes['role'],
            ]);

            $this->audit->log($actor, 'user_created', $user, [
                'role' => $user->role,
            ]);

            return $user;
        });

        return $user;
    }

    /**
     * Edit an account's name, email and (optionally) role.
     *
     * A role change goes through UserRoleService so the self-change guard and
     * the `role_changed` audit row behave exactly as they do on the dedicated
     * role endpoint — the edit form is not a second, weaker door into the
     * same decision.
     *
     * @param  array{name: string, email: string, role?: string|null}  $attributes
     *
     * @throws ValidationException when the actor tries to change their own role.
     */
    public function update(User $actor, User $target, array $attributes): User
    {
        // Transactional because the role change can be refused (self-change)
        // AFTER the profile fields are written: without this, a refused edit
        // would still land the new name/email while the response said 422.
        DB::transaction(function () use ($actor, $target, $attributes): void {
            $target->update([
                'name' => $attributes['name'],
                'email' => $attributes['email'],
            ]);

            $role = $attributes['role'] ?? null;

            if ($role !== null && $role !== $target->role) {
                $this->roles->assignRole($actor, $target, $role);
            }

            $this->audit->log($actor, 'user_updated', $target, [
                'role' => $target->role,
            ]);
        });

        return $target->refresh();
    }

    /**
     * Deactivate an account: soft-delete it and end every session it holds.
     *
     * Revoking sessions is what makes the deactivation immediate. Soft-deleting
     * alone would stop *new* logins (the user provider cannot resolve a
     * trashed row) but leave an already-open session working until it expired,
     * which is exactly the window a deactivation is meant to close.
     *
     * @throws ValidationException when the actor targets their own account.
     */
    public function deactivate(User $actor, User $target): User
    {
        if ($actor->is($target)) {
            throw ValidationException::withMessages([
                'user' => 'You cannot deactivate your own account. Ask another administrator to do it.',
            ]);
        }

        DB::transaction(function () use ($actor, $target): void {
            $this->auth->logoutEverywhere($target);

            $target->delete();

            $this->audit->log($actor, 'user_deactivated', $target, [
                'role' => $target->role,
            ]);
        });

        return $target;
    }

    /**
     * Reactivate a deactivated account (restore the soft delete).
     *
     * No session/token work needed in this direction: the account has none,
     * and the person signs in again with their existing password.
     */
    public function reactivate(User $actor, User $target): User
    {
        $target->restore();

        $this->audit->log($actor, 'user_reactivated', $target, [
            'role' => $target->role,
        ]);

        return $target->refresh();
    }
}
