<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Absolute session lifetime for cookie sessions (item 1).
 *
 * Laravel's SESSION_LIFETIME is an IDLE timeout only — the clock is renewed
 * on every request, so a session that is used daily never dies. A
 * government-grade system also wants an ABSOLUTE ceiling: after
 * SECURITY_SESSION_ABSOLUTE minutes from login, the session is invalid no
 * matter how active it has been, and the user must re-authenticate.
 *
 * Mechanism: on LOGIN the session is stamped with `login_at` (the session
 * id is also regenerated then, so the stamp cannot predate the credentials).
 * On every subsequent request this middleware compares that stamp against
 * the ceiling; an over-the-limit session is destroyed server-side (its
 * `sessions` row deleted, so logout-everywhere style revocation is
 * consistent) and the request is answered 401.
 *
 * Bearer tokens are NOT affected: their absolute expiry is enforced per
 * token by Sanctum via expires_at (see AuthService::issueToken).
 *
 * Registered on the `api` group in bootstrap/app.php — right after
 * statefulApi() — so it only ever runs for API requests.
 */
class AbsoluteSessionExpiry
{
    /** Session key holding the login timestamp. */
    public const LOGIN_AT = 'login_at';

    public function handle(Request $request, Closure $next): Response
    {
        $session = $request->hasSession() ? $request->session() : null;

        if ($session !== null && $session->has(self::LOGIN_AT)) {
            $absoluteMinutes = max(1, (int) config('security.session_absolute', 720));

            $loginAt = \Illuminate\Support\Carbon::parse($session->get(self::LOGIN_AT));

            if ($loginAt->lt(now()->subMinutes($absoluteMinutes))) {
                // Server-side revocation first: the row must die even if the
                // client never renders the 401.
                DB::table(config('session.table', 'sessions'))
                    ->where('id', $session->getId())
                    ->delete();

                $session->flush();
                $session->invalidate();

                return response()->json([
                    'message' => 'Your session has expired. Please sign in again.',
                ], 401);
            }
        }

        return $next($request);
    }
}
