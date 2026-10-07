<?php

namespace App\Services;

use App\Models\User;
use App\Notifications\AccountSetup;
use App\Services\Auth\AuthService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
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
     * INVITES: `password` is optional. When the admin does not type one, the
     * account starts with an unguessable random value it cannot sign in with
     * and receives a one-time setup link (the Laravel password broker —
     * hashed, single-use, time-limited) so the new staff member sets their
     * OWN password. The link is returned to the actor as well as emailed:
     * delivery depends on the configured mailer, and "no SMTP yet" must not
     * block onboarding — the admin can hand the link over directly.
     *
     * @param  array{name: string, email: string, password?: string|null, role: string}  $attributes
     * @return array{user: User, setup_url: string|null}
     */
    public function create(User $actor, array $attributes): array
    {
        $invited = ($attributes['password'] ?? null) === null;

        $user = DB::transaction(function () use ($actor, $attributes, $invited): User {
            // The `password` => 'hashed' cast on User hashes on assignment.
            // For an invite, a random 32-char value holds the column: nobody
            // knows it, so the account is unusable until the setup link
            // completes — which is the point.
            $user = User::create([
                'name' => $attributes['name'],
                'email' => $attributes['email'],
                'password' => $attributes['password'] ?? Str::password(32, symbols: false),
                'role' => $attributes['role'],
                'created_by' => $actor->id,
            ]);

            $this->audit->log($actor, $invited ? 'user_invited' : 'user_created', $user, [
                'role' => $user->role,
                'invited' => $invited,
            ]);

            return $user;
        });

        if (! $invited) {
            return ['user' => $user, 'setup_url' => null];
        }

        // The same broker the public "forgot password" flow uses: the token
        // is stored hashed, single-use, expiring per
        // config('auth.passwords.users.expire').
        $token = \Illuminate\Support\Facades\Password::createToken($user);

        // Reuse the SPA URL shape the reset flow already publishes through
        // ResetPassword::createUrlUsing, so both links land on the same page
        // and completion endpoint.
        $frontend = rtrim((string) config('app.frontend_url', env('FRONTEND_URL', 'http://localhost:5173')), '/');

        $setupUrl = $frontend.'/reset-password?token='.$token.'&email='.urlencode($user->email);

        // Best effort: a mailer failure must not fail the invite — the URL is
        // already in the admin's hands. Under the default `log` mailer this
        // simply writes to the application log.
        try {
            $user->notify(new AccountSetup($setupUrl));
        } catch (\Throwable $e) {
            report($e);
        }

        return ['user' => $user, 'setup_url' => $setupUrl];
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

    /**
     * Deactivate many accounts in one request — the bulk row of the same
     * lifecycle. Each account goes through deactivate() individually, so the
     * self-guard, the session revocation and the per-row audit all behave
     * exactly as the single-account path does; the actor's own account is
     * skipped, not a crash in the middle of the batch.
     *
     * @param  list<int>  $ids
     * @return array{updated: int, failed_ids: list<int>}
     */
    public function deactivateMany(User $actor, array $ids): array
    {
        $updated = 0;
        $failed = [];

        foreach (User::query()->whereIn('id', $ids)->get() as $target) {
            try {
                $this->deactivate($actor, $target);
                $updated++;
            } catch (ValidationException) {
                $failed[] = $target->id;
            }
        }

        return ['updated' => $updated, 'failed_ids' => $failed];
    }
}
