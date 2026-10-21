<?php

namespace App\Services\Auth;

use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class AuthService
{
    public function __construct(
        private readonly AccountLockout $lockout,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Validate credentials and return the matching user.
     *
     * The identifier may be either an email address or a username.
     *
     * Hardening (items 1, 2, 7): every attempt — success or failure — is
     * audited; failed attempts feed the per-account lockout; and a locked
     * account refuses authentication with 423 BEFORE any credential check.
     *
     * Error messages are DELIBERATELY specific about which half failed:
     * an unknown identifier says so, and a known identifier with the wrong
     * password says so. This trades away user-enumeration protection for a
     * clearer sign-in experience (product decision) — do not collapse the
     * two back into one generic message without revisiting that call.
     *
     * Stateless by design; the controller starts the session (SPA)
     * or issues a token (mobile) afterwards.
     *
     * @throws ValidationException
     */
    public function login(string $identifier, string $password): User
    {
        $identifier = Str::lower(trim($identifier));

        $user = User::query()
            ->where('email', $identifier)
            ->orWhere('username', $identifier)
            ->first();

        if (! $user) {
            // Unknown identifier: the failure is still audited (with no actor
            // — there is no account to attribute it to) but cannot count
            // toward any account's lockout.
            $this->audit->log(null, 'failed_login', User::class, [
                'identifier' => $identifier,
                'reason' => 'unknown_account',
            ]);

            throw ValidationException::withMessages([
                'identifier' => __('No account found with that username or email.'),
            ]);
        }

        // Item 2: refuse BEFORE checking credentials, so a locked account
        // gives no oracle about password correctness during the cooldown.
        $this->lockout->assertNotLocked($user);

        if (! Hash::check($password, $user->password)) {
            $this->lockout->recordFailure($user);

            $this->audit->log($user, 'failed_login', User::class, [
                'reason' => 'bad_password',
            ]);

            // Keyed to `password` (not `identifier`) so the SPA shows the
            // message against the password input, which is the field that
            // actually needs fixing.
            throw ValidationException::withMessages([
                'password' => __('Incorrect password.'),
            ]);
        }

        $this->lockout->clear($user);

        // The fact the User Management table shows per account ("last
        // login"). saveQuietly: this is bookkeeping, not a model event the
        // rest of the system should react to.
        $user->forceFill(['last_login_at' => now()])->saveQuietly();

        $this->audit->log($user, 'login', User::class);

        return $user;
    }

    /**
     * Issue a personal access token for the user (mobile clients).
     *
     * Item 1: every token carries an absolute `expires_at` (config
     * security.token_absolute); the idle window is enforced on every request
     * by IdleExpiringGuard. Audited as token_issued so the log shows device
     * sessions an account holds.
     */
    public function issueToken(User $user, string $deviceName): string
    {
        $expiresAt = now()->addMinutes(max(1, (int) config('security.token_absolute', 10080)));

        $token = $user->createToken($deviceName, ['*'], $expiresAt)->plainTextToken;

        $this->audit->log($user, 'token_issued', User::class, [
            'device_name' => $deviceName,
        ]);

        return $token;
    }

    /**
     * Revoke the current access token (if any) or log out the session.
     */
    public function logout(User $user, bool $hasSession): void
    {
        if ($user->currentAccessToken() instanceof PersonalAccessToken) {
            $user->currentAccessToken()->delete();

            $this->audit->log($user, 'logout', User::class, ['scope' => 'token']);

            return;
        }

        if ($hasSession) {
            Auth::guard('web')->logout();

            $this->audit->log($user, 'logout', User::class, ['scope' => 'session']);
        }
    }

    /**
     * "Log me out everywhere": revoke every personal access token and every
     * cookie session the account holds (item 1).
     *
     * Used by the dedicated logout-all endpoint AND automatically after a
     * password change or reset, so a stolen session/token does not survive a
     * credential change.
     *
     * @return int The number of tokens revoked (sessions are rows in the
     *             `sessions` table; they are deleted, not counted).
     */
    public function logoutEverywhere(User $user): int
    {
        $revoked = $user->tokens()->delete();

        // Cookie sessions: the database session driver stores rows keyed by
        // session id with a user_id column (see the sessions migration).
        DB::table(config('session.table', 'sessions'))
            ->where('user_id', $user->id)
            ->delete();

        return (int) $revoked;
    }

    /**
     * Invalidate every OTHER session/token, keeping the caller's own alive
     * (item 1: password change). The device that just presented the current
     * password stays signed in; a stolen session on some other device does
     * not. Sanctum's AuthenticateSession middleware independently kills even
     * the current cookie session on password change — belt and braces.
     */
    public function revokeOtherSessions(User $user, ?string $currentSessionId, ?PersonalAccessToken $currentToken): void
    {
        $sessionQuery = DB::table(config('session.table', 'sessions'))
            ->where('user_id', $user->id);

        if ($currentSessionId !== null) {
            $sessionQuery->where('id', '!=', $currentSessionId);
        }

        $sessionQuery->delete();

        $tokenQuery = $user->tokens();

        if ($currentToken !== null) {
            $tokenQuery->where('id', '!=', $currentToken->id);
        }

        $tokenQuery->delete();
    }
}
