<?php

namespace App\Services;

use App\Models\User;
use App\Notifications\AccountSetup;
use App\Services\Auth\AuthService;
use App\Services\Auth\EmailVerificationService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Account lifecycle for the admin User Management screen: create a staff
 * account, edit its profile, deactivate it, bring it back, and permanently
 * delete an account that never accumulated records.
 *
 * Deactivation is the soft delete the rest of the system already uses, and it
 * is the answer for any account that has worked: rows across the database
 * reference `users.id` (a beneficiary's technician, authored health and case
 * records, the audit trail), so a hard delete would either orphan or destroy
 * that history. Permanent deletion therefore exists only for accounts with no
 * such records — a mistyped invite or an abandoned test account — and refuses
 * everything else with a pointer to deactivate instead.
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
        private readonly EmailVerificationService $verifications,
    ) {}

    /**
     * Create a staff account.
     *
     * Every account in the system is staff — there is no farmer role, and
     * beneficiaries are program records the admin enters on the
     * Beneficiaries screen, not login accounts.
     *
     * EVERY new account starts unverified: `email_verified_at` stays null
     * until the owner opens the emailed link, and login refuses an unverified
     * account (AuthService). That is true whether the administrator typed a
     * password or not.
     *
     * INVITES: `password` is optional. When the admin does not type one, the
     * account starts with an unguessable random value it cannot sign in with.
     * After the owner verifies their address, the verification response
     * carries a one-time setup link (the Laravel password broker — hashed,
     * single-use, time-limited) so they choose their OWN password.
     *
     * @param  array{name: string, email: string, password?: string|null, role: string}  $attributes
     * @return array{user: User, setup_url: string|null, verification: array{email_sent: bool, expires_at: string, expires_in_hours: int}}
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

        // The verification email is the onboarding message for BOTH modes.
        // Sending is best effort: the account exists and can be re-sent from
        // the Users table, so a transport hiccup must not fail the create.
        $verification = $this->verifications->issue($user, $invited);

        return [
            // Loaded so UserResource can report the pending state without an
            // extra query (it only reports verification when eager-loaded).
            'user' => $user->load('emailVerificationToken'),
            'setup_url' => null,
            'verification' => [
                'email_sent' => $verification['sent'],
                'expires_at' => $verification['expires_at']->toIso8601String(),
                'expires_in_hours' => EmailVerificationService::expiryHours(),
            ],
        ];
    }

    /**
     * Re-issue the email verification link for a pending account. A new token
     * replaces the old row, so the previous link stops working immediately.
     *
     * @return array{email: string, email_sent: bool, expires_at: string, expires_in_hours: int}
     *
     * @throws ValidationException when the account is disabled or already verified.
     */
    public function resendVerificationEmail(User $actor, User $target): array
    {
        if ($target->trashed()) {
            throw ValidationException::withMessages([
                'user' => 'Reactivate the account before resending the verification email.',
            ]);
        }

        if ($target->email_verified_at !== null) {
            throw ValidationException::withMessages([
                'user' => 'This email address is already verified. There is nothing to resend.',
            ]);
        }

        $result = $this->verifications->issue($target, $target->last_login_at === null);

        $this->audit->log($actor, 'verification_email_sent', $target, [
            'delivered' => $result['sent'],
        ]);

        return [
            'email' => $target->email,
            'email_sent' => $result['sent'],
            'expires_at' => $result['expires_at']->toIso8601String(),
            'expires_in_hours' => EmailVerificationService::expiryHours(),
        ];
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

        // Recovery is a verified-account capability: an unverified mailbox has
        // not proven ownership, so its reset link would be a takeover path.
        if ($target->email_verified_at === null) {
            throw ValidationException::withMessages([
                'user' => 'This email address has not been verified yet. Resend the verification email first.',
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
        $emailChanged = $attributes['email'] !== $target->email;

        // Transactional because the role change can be refused (self-change)
        // AFTER the profile fields are written: without this, a refused edit
        // would still land the new name/email while the response said 422.
        DB::transaction(function () use ($actor, $target, $attributes, $emailChanged): void {
            // Repointing an account at a different mailbox clears its
            // verification in the SAME write. Otherwise an administrator (or
            // a stolen admin session) could move a verified account to an
            // address nobody has proven they can read — exactly the bypass
            // the verification gate exists to prevent.
            $target->forceFill([
                'name' => $attributes['name'],
                'email' => $attributes['email'],
                'email_verified_at' => $emailChanged ? null : $target->email_verified_at,
            ])->save();

            $role = $attributes['role'] ?? null;

            if ($role !== null && $role !== $target->role) {
                $this->roles->assignRole($actor, $target, $role);
            }
            // Audit rows for the profile fields and (separately) the role are
            // written by the User model inside this transaction.
        });

        if ($emailChanged) {
            // A new address gets a new link; the old token is replaced, so a
            // link sent to the previous mailbox can never verify the new one.
            $result = $this->verifications->issue($target, $target->last_login_at === null);

            $this->audit->log($actor, 'verification_email_sent', $target, [
                'reason' => 'email_changed',
                'delivered' => $result['sent'],
            ]);
        }

        return $target->refresh()->load('emailVerificationToken');
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
     * Permanently delete an account — the irreversible counterpart to
     * deactivate(), for rows that never accumulated records.
     *
     * Refused when the account authored anything the program must keep: a
     * field visit, monitoring or clinical record, a vaccination, a plan, a
     * household it monitors, an assignment it made or received, a sync
     * conflict or a project. Those rows name the person who wrote them,
     * and no account deletion should be able to erase or orphan them — the
     * admin is told to deactivate instead.
     *
     * What is removed with a deletable account is only its own residue:
     * sessions, API tokens, pending reset codes and notifications. An audit
     * row survives the account: the actor snapshot on existing rows is what
     * keeps the trail readable after the person is gone.
     *
     * @return array{name: string, email: string}
     *
     * @throws ValidationException when the actor targets their own account or
     *                             the account still holds records.
     */
    public function purge(User $actor, User $target): array
    {
        if ($actor->is($target)) {
            throw ValidationException::withMessages([
                'user' => 'You cannot permanently delete your own account. Ask another administrator to do it.',
            ]);
        }

        $held = $this->recordsHeldBy($target);

        if ($held !== []) {
            $summary = collect($held)
                ->map(fn (int $count, string $label): string => $count.' '.$label)
                ->implode(', ');

            throw ValidationException::withMessages([
                'user' => 'This account still holds records ('.$summary.'), so it cannot be permanently deleted. Deactivate it instead — those records name the person who made them.',
            ]);
        }

        try {
            DB::transaction(function () use ($actor, $target): void {
                $this->auth->logoutEverywhere($target);

                // The account's own residue. None of it is shared, and leaving
                // it behind would keep a dead account's email reserved in the
                // reset tables.
                DB::table('sessions')->where('user_id', $target->id)->delete();
                DB::table('password_reset_tokens')->where('email', $target->email)->delete();
                DB::table('password_reset_otps')->where('email', $target->email)->delete();
                DB::table('user_notifications')->where('user_id', $target->id)->delete();

                // The Auditable trait labels any delete `user_deactivated`.
                // A force delete is not that: suppress the trait's row and
                // write the accurate one below, inside the same transaction.
                $target->skipNextAudit()->forceDelete();

                $this->audit->log($actor, 'user_deleted', $target, [
                    'email' => $target->email,
                    'role' => $target->role,
                ]);
            });
        } catch (QueryException $e) {
            // A foreign key the pre-check does not name (a table added later)
            // must still answer 422, not 500 — and the transaction has rolled
            // the whole delete back, so nothing is half-removed.
            report($e);

            throw ValidationException::withMessages([
                'user' => 'This account still has records linked to it, so it cannot be permanently deleted. Deactivate it instead.',
            ]);
        }

        return ['name' => $target->name, 'email' => $target->email];
    }

    /**
     * Rows that would block a permanent delete, with how many of each — read
     * before the delete so the refusal can say what is holding the account.
     *
     * @return array<string, int>
     */
    private function recordsHeldBy(User $target): array
    {
        $checks = [
            'field visit(s)' => ['field_visits', 'technician_id'],
            'monitoring record(s)' => ['monitoring_records', 'technician_id'],
            'health record(s)' => ['health_records', 'doctor_id'],
            'case note(s)' => ['case_notes', 'doctor_id'],
            'vaccination record(s)' => ['vaccinations', 'technician_id'],
            'visit plan(s)' => ['field_visit_plans', 'technician_id'],
            'visit photo(s)' => ['field_visit_photos', 'technician_id'],
            'household(s) they currently monitor' => ['beneficiaries', 'technician_id'],
            'assignment(s) they made' => ['technician_assignments', 'assigned_by'],
            'assignment history row(s)' => ['technician_assignments', 'technician_id'],
            'previous-assignment reference(s)' => ['technician_assignments', 'previous_technician_id'],
            'sync conflict(s)' => ['sync_conflicts', 'user_id'],
            'project(s)' => ['projects', 'user_id'],
        ];

        $held = [];

        foreach ($checks as $label => [$table, $column]) {
            $count = DB::table($table)->where($column, $target->id)->count();

            if ($count > 0) {
                $held[$label] = $count;
            }
        }

        return $held;
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
