<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * The ONE definition of "online" for the whole system.
 *
 * An account is online when ALL of these hold:
 *
 *   1. it is not deactivated (deactivation is the soft delete, so no
 *      `deleted_at`),
 *   2. it has been seen within `security.presence_window` minutes — the
 *      activity middleware and the SPA heartbeat keep `last_seen_at` fresh,
 *   3. it has not signed out since that last-seen stamp
 *      (`last_logout_at` is null or older than `last_seen_at`), and
 *   4. a live credential still exists: a cookie session row inside the idle
 *      window, or a personal access token that is neither expired nor idle.
 *
 * Presence and account status are deliberately separate: a deactivated
 * account is Deactivated (not Offline), and the API's `status` field keeps
 * reporting the account state.
 *
 * The same constraints are used three ways so the rule cannot drift:
 *   - `User::scopeOnline()` / `scopeOffline()` for SQL filtering and counts,
 *   - `prime()` for a whole page (two queries, never N+1),
 *   - `isOnline()` for a single account (the activity drawer, a write
 *     response).
 *
 * Credential note: when the server has no session store to consult (the
 * `array`/`file` drivers — tests, and deployments that keep sessions on
 * disk), a cookie session leaves no row to inspect. In that case an account
 * holding no tokens is judged on `last_seen_at` alone; an account holding
 * tokens is still judged by them, so a revoked token reads offline.
 */
class Presence
{
    /** How recently an account must have been seen to count as online. */
    public static function windowMinutes(): int
    {
        return max(1, (int) config('security.presence_window', 5));
    }

    /**
     * Add the online rule to a query on `users`.
     *
     * @param  Builder<User>  $query
     */
    public static function onlineConstraints(Builder $query): void
    {
        $query->whereNull('users.deleted_at')
            ->whereNotNull('users.last_seen_at')
            ->where('users.last_seen_at', '>=', now()->subMinutes(self::windowMinutes()))
            ->where(function (Builder $q): void {
                $q->whereNull('users.last_logout_at')
                    ->orWhereColumn('users.last_logout_at', '<', 'users.last_seen_at');
            });

        self::liveCredentialConstraints($query);
    }

    /**
     * @param  Builder<User>  $query
     */
    public static function offlineConstraints(Builder $query): void
    {
        // whereNot() wraps the closure and negates the whole group, which is
        // exactly "any one of the online conditions does not hold".
        $query->whereNot(function (Builder $q): void {
            self::onlineConstraints($q);
        });
    }

    /**
     * Whether one account is online right now.
     *
     * @param  bool|null  $liveCredential  Pre-resolved answer for "does a live
     *                                     credential exist" (see prime()).
     */
    public static function isOnline(User $user, ?bool $liveCredential = null): bool
    {
        if ($user->deleted_at !== null) {
            return false;
        }

        if ($user->last_seen_at === null
            || $user->last_seen_at->lt(now()->subMinutes(self::windowMinutes()))) {
            return false;
        }

        if ($user->last_logout_at !== null
            && $user->last_logout_at->gte($user->last_seen_at)) {
            return false;
        }

        return $liveCredential ?? self::hasLiveCredential($user);
    }

    /**
     * Resolve presence for a whole page of accounts in two queries, so the
     * user list never runs a credential check per row.
     *
     * @param  Collection<int, User>  $users
     */
    public static function prime(Collection $users): void
    {
        if ($users->isEmpty()) {
            return;
        }

        $live = User::query()->whereKey($users->pluck('id')->all());
        self::liveCredentialConstraints($live);
        $liveIds = $live->pluck('id')->all();

        foreach ($users as $user) {
            $user->presenceCache = self::isOnline($user, in_array($user->id, $liveIds, true));
        }
    }

    /**
     * Does this account still hold a session row or token that has not
     * expired, gone idle or been revoked?
     */
    private static function hasLiveCredential(User $user): bool
    {
        $query = User::query()->whereKey($user->getKey());
        self::liveCredentialConstraints($query);

        return $query->exists();
    }

    /**
     * @param  Builder<User>  $query
     */
    private static function liveCredentialConstraints(Builder $query): void
    {
        $sessionsTracked = config('session.driver') === 'database';
        $tokenIdle = max(1, (int) config('security.token_idle', 240));
        $tokenableType = $query->getModel()->getMorphClass();

        $query->where(function (Builder $q) use ($sessionsTracked, $tokenIdle, $tokenableType): void {
            // Mobile: a token that is neither past its absolute expiry nor
            // idle past SECURITY_TOKEN_IDLE (the same window
            // IdleExpiringGuard enforces on authentication).
            $q->whereExists(fn ($sub) => $sub->selectRaw('1')
                ->from('personal_access_tokens')
                ->whereColumn('personal_access_tokens.tokenable_id', 'users.id')
                ->where('personal_access_tokens.tokenable_type', $tokenableType)
                ->where(fn ($t) => $t->whereNull('personal_access_tokens.expires_at')
                    ->orWhere('personal_access_tokens.expires_at', '>', now()))
                ->where(fn ($t) => $t->whereNull('personal_access_tokens.last_used_at')
                    ->orWhere('personal_access_tokens.last_used_at', '>=', now()->subMinutes($tokenIdle))));

            if ($sessionsTracked) {
                // SPA: a session row whose last_activity is inside the idle
                // window. The absolute ceiling is enforced by deleting the row
                // (AbsoluteSessionExpiry), so a surviving row is a live one.
                $q->orWhereExists(fn ($sub) => $sub->selectRaw('1')
                    ->from('sessions')
                    ->whereColumn('sessions.user_id', 'users.id')
                    ->where('sessions.last_activity', '>=', now()->subMinutes(
                        max(1, (int) config('security.session_idle', 120)),
                    )->getTimestamp()));
            } else {
                // No session store to inspect — see the class docblock.
                $q->orWhereNotExists(fn ($sub) => $sub->selectRaw('1')
                    ->from('personal_access_tokens')
                    ->whereColumn('personal_access_tokens.tokenable_id', 'users.id')
                    ->where('personal_access_tokens.tokenable_type', $tokenableType));
            }
        });
    }
}
