<?php

namespace App\Services;

use App\Models\User;
use App\Notifications\AccountSetup;
use App\Services\Auth\AuthService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
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
     * Every account in the system is staff — there is no farmer role, and
     * beneficiaries are program records the admin enters on the
     * Beneficiaries screen, not login accounts.
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
            // An invite is a distinct audit event from a plain create, so the
            // trait's row is relabelled before the create it is about to
            // write (one-shot — see Auditable::auditNextCreatedAs).
            if ($invited) {
                User::auditNextCreatedAs('user_invited', ['invited' => true]);
            }

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

            return $user;
        });

        if (! $invited) {
            return ['user' => $user, 'setup_url' => null];
        }

        return ['user' => $user, 'setup_url' => $this->issueSetupUrl($user)];
    }

    /**
     * One-time setup link (and its email) for an invited account.
     *
     * The same broker the public "forgot password" flow uses: hashed, single-use,
     * expiring per config('auth.passwords.users.expire'). Issue again replaces
     * the previous token, so an old link cannot be replayed.
     */
    private function issueSetupUrl(User $user): string
    {
        $token = Password::createToken($user);

        // Reuse the SPA URL shape the reset flow already publishes through
        // ResetPassword::createUrlUsing, so both links land on the same page
        // and completion endpoint.
        $frontend = rtrim((string) config('app.frontend_url', env('FRONTEND_URL', 'http://localhost:5173')), '/');

        $setupUrl = $frontend.'/reset-password?token='.$token.'&email='.urlencode($user->email);

        // Best effort: a mailer failure must not fail the action — the URL is
        // already in the admin's hands. Under the default `log` mailer this
        // simply writes to the application log.
        try {
            $user->notify(new AccountSetup($setupUrl));
        } catch (\Throwable $e) {
            report($e);
        }

        return $setupUrl;
    }

    /**
     * Re-issue the setup link for an account that has never signed in.
     *
     * Deliberately narrower than a password reset: an account that has already
     * used the system has a password the owner knows, and handing an
     * administrator a fresh setup token for it would be a takeover path.
     */
    public function resendSetupLink(User $actor, User $target): string
    {
        if ($target->trashed()) {
            throw ValidationException::withMessages([
                'user' => 'Reactivate the account before sending a setup link.',
            ]);
        }

        if ($target->last_login_at !== null) {
            throw ValidationException::withMessages([
                'user' => 'This account has already signed in. Send a password reset instead.',
            ]);
        }

        if (! in_array($target->role, User::STAFF_ROLES, true)) {
            throw ValidationException::withMessages([
                'user' => 'Only staff accounts have setup links.',
            ]);
        }

        $setupUrl = $this->issueSetupUrl($target);
        $this->audit->log($actor, 'setup_link_resent', $target);

        return $setupUrl;
    }

    /**
     * Email the account's owner a password-reset link. The administrator never
     * types or sees a password; the broker's own throttle stops repeated
     * sends.
     *
     * @return string One of Password::RESET_LINK_SENT / RESET_THROTTLED /
     *                INVALID_USER — the controller maps it to a response.
     */
    public function sendPasswordReset(User $actor, User $target): string
    {
        if ($target->trashed()) {
            throw ValidationException::withMessages([
                'user' => 'Reactivate the account before sending a password reset.',
            ]);
        }

        $status = Password::sendResetLink(['email' => $target->email]);

        if ($status === Password::RESET_LINK_SENT) {
            $this->audit->log($actor, 'password_reset_requested', $target, [
                'admin_initiated' => true,
            ]);
        }

        return $status;
    }

    /**
     * End every session and API token the account holds without deactivating
     * it — the response to a lost device or a suspected stolen session.
     * Refuses the actor's own account: use Sign out, not a security action
     * that would kill the session making the request.
     */
    public function revokeSessions(User $actor, User $target): int
    {
        if ($actor->is($target)) {
            throw ValidationException::withMessages([
                'user' => 'Use Sign out for your own account; this action is for other accounts.',
            ]);
        }

        if ($target->trashed()) {
            throw ValidationException::withMessages([
                'user' => 'The account is deactivated and has no active sessions.',
            ]);
        }

        $revoked = $this->auth->logoutEverywhere($target);

        $this->audit->log($actor, 'sessions_revoked', $target, [
            'tokens_revoked' => $revoked,
        ]);

        return $revoked;
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
            // Audit rows for the profile fields and (separately) the role are
            // written by the User model inside this transaction.
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

        DB::transaction(function () use ($target): void {
            $this->auth->logoutEverywhere($target);

            // The User model writes `user_deactivated` inside this
            // transaction (soft delete ⇒ deleted event).
            $target->delete();
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
        // A retired farmer row is soft-deleted history, not a dormant
        // account: restoring one would hand a login back to the removed role
        // with its old password. Staff is the only reactivatable kind —
        // defense in depth, since the admin list already hides non-staff rows
        // and `role` never validates to `farmer` anywhere else.
        if (! in_array($target->role, User::STAFF_ROLES, true)) {
            throw ValidationException::withMessages([
                'user' => 'Only staff accounts can be reactivated.',
            ]);
        }

        DB::transaction(fn () => $target->restore());

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

    /**
     * Restore many dormant accounts. Each row goes through reactivate(), so
     * the staff-role guard and the per-row audit behave exactly as the single
     * path does; a non-staff row is reported, not fatal to the batch.
     *
     * @param  list<int>  $ids
     * @return array{updated: int, failed_ids: list<int>}
     */
    public function reactivateMany(User $actor, array $ids): array
    {
        $updated = 0;
        $failed = [];

        foreach (User::withTrashed()->whereIn('id', $ids)->get() as $target) {
            try {
                $this->reactivate($actor, $target);
                $updated++;
            } catch (ValidationException) {
                $failed[] = $target->id;
            }
        }

        return ['updated' => $updated, 'failed_ids' => $failed];
    }
}
