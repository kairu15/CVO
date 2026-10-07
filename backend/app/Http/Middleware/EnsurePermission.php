<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Requires the authenticated user to hold EVERY named permission.
 *
 * Used as `middleware('permission:manage_users')`. This is the runtime half
 * of the Roles & Permissions matrix: an administrator's grants decide who
 * passes, not a role comparison. `EnsureUserIsAdmin` remains as the
 * all-of-admin-module shorthand where per-route granularity is not wanted.
 */
class EnsurePermission
{
    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $user = $request->user();

        foreach ($permissions as $permission) {
            if ($user === null || ! $user->hasPermission($permission)) {
                abort(Response::HTTP_FORBIDDEN, "Missing required permission [{$permission}].");
            }
        }

        return $next($request);
    }
}
