<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keeps `users.last_seen_at` warm on authenticated API requests.
 *
 * This is what turns `last_login_at` ("signed in once") into real presence:
 * a cookie session or a bearer token that keeps making requests is seen, so
 * User Management can show Online without a second activity store.
 *
 * Rules, all deliberate:
 *   - THROTTLED: at most one write per minute per account. The comparison is
 *     against the loaded value, so a burst of parallel requests costs one
 *     UPDATE, not one per request.
 *   - saveQuietly(): bookkeeping must not fire model events (no audit rows,
 *     no observers) — this is not an edit of the account.
 *   - Never for unauthenticated requests: `$request->user()` is null there.
 *   - Never fatal: any failure is reported and swallowed, because activity
 *     bookkeeping must never break the request it is bookkeeping FOR.
 *
 * Registered on the authenticated API group (after `auth:sanctum`), so it
 * runs for both cookie sessions and Sanctum tokens.
 */
class TrackUserActivity
{
    /** Minimum seconds between writes for one account. */
    public const THROTTLE_SECONDS = 60;

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        self::record($request->user());

        return $response;
    }

    /**
     * Stamp the account as seen now, unless it was stamped moments ago.
     *
     * Public and static so the heartbeat endpoint can force a write without
     * duplicating the bookkeeping rules.
     */
    public static function record(?Authenticatable $user, bool $force = false): void
    {
        if (! $user instanceof User) {
            return;
        }

        try {
            $now = now();

            if (! $force
                && $user->last_seen_at !== null
                && $user->last_seen_at->gt($now->copy()->subSeconds(self::THROTTLE_SECONDS))) {
                return;
            }

            // forceFill + saveQuietly: an activity stamp is not an account
            // edit, so it must not reach the audit trail or model observers.
            $user->forceFill(['last_seen_at' => $now])->saveQuietly();
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
