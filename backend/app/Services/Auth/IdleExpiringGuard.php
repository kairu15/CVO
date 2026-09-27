<?php

namespace App\Services\Auth;

use Laravel\Sanctum\Guard;

/**
 * Sanctum's Guard, plus an idle window for personal access tokens.
 *
 * Sanctum natively honors only the token's absolute `expires_at` (or the
 * global `sanctum.expiration`). Government-grade idle expiry needs a token to
 * die after inactivity, so this guard additionally rejects a token whose
 * `last_used_at` is older than SECURITY_TOKEN_IDLE minutes.
 *
 * Mechanism: Sanctum::authenticateAccessTokensCallback — the same hook the
 * config points at this class — receives ($accessToken, $isValid) after the
 * parent's checks; returning false here fails authentication and the mobile
 * client gets 401 and re-logins. `last_used_at` is refreshed by Sanctum
 * itself on every authenticated request, which is exactly the idle-clock
 * reset a sliding window needs.
 *
 * The web (session) guard is unaffected: cookie sessions are governed by
 * SESSION_LIFETIME + item 1's absolute ceiling, not by this class.
 */
class IdleExpiringGuard extends Guard
{
    /**
     * Idle window in minutes for personal access tokens.
     */
    public static function idleMinutes(): int
    {
        return max(1, (int) config('security.token_idle', 240));
    }

    /**
     * Sanctum::authenticateAccessTokensCallback signature.
     *
     * @param  \Laravel\Sanctum\PersonalAccessToken  $accessToken
     * @param  bool  $isValid
     * @return bool
     */
    public static function checkIdle($accessToken, $isValid): bool
    {
        if (! $isValid) {
            return false;
        }

        // Tokens issued before the idle policy (or with a null last_used_at —
        // brand new tokens) get a pass on the idle check; the absolute
        // expires_at still applies to them.
        if ($accessToken->last_used_at === null) {
            return true;
        }

        return $accessToken->last_used_at->gt(
            now()->subMinutes(self::idleMinutes()),
        );
    }
}
