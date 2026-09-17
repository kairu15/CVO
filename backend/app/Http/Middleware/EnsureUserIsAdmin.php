<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Blocks non-administrators from the /api/v1/admin/* routes.
 *
 * The write endpoints additionally authorize through their FormRequests, but
 * this keeps the read endpoints (user lists, beneficiary directory) admin-only
 * as well, in one place.
 */
class EnsureUserIsAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->user()?->role !== 'admin') {
            abort(Response::HTTP_FORBIDDEN, 'Administrator access required.');
        }

        return $next($request);
    }
}
