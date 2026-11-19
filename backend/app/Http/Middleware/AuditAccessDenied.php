<?php

namespace App\Http\Middleware;

use App\Services\AuditLogger;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * Put refused access on the audit trail.
 *
 * The audit vocabulary already covers failed sign-ins and lockouts; a 403
 * from a policy or capability middleware is the other half of "someone tried
 * to reach something they may not". This is not a second logging system: it
 * calls the same AuditLogger, once per user/route per five minutes, so a
 * script cannot turn the audit table into a denial-of-service target.
 *
 * Anonymous requests are not logged (there is no actor to attribute, and the
 * route's own auth layer already refuses them).
 */
class AuditAccessDenied
{
    private const THROTTLE_SECONDS = 300;

    public function __construct(private readonly AuditLogger $audit) {}

    public function handle(Request $request, Closure $next): Response
    {
        try {
            $response = $next($request);
        } catch (\Throwable $e) {
            if ($this->isForbidden($e)) {
                $this->record($request);
            }

            throw $e;
        }

        // Laravel's routing pipeline renders exceptions thrown by inner route
        // middleware (such as `permission:`) into a response before they
        // travel back out, so the 403 has to be noticed here too.
        if ($response->getStatusCode() === Response::HTTP_FORBIDDEN) {
            $this->record($request);
        }

        return $response;
    }

    private function isForbidden(\Throwable $e): bool
    {
        return $e instanceof AuthorizationException
            || ($e instanceof HttpExceptionInterface && $e->getStatusCode() === Response::HTTP_FORBIDDEN);
    }

    private function record(Request $request): void
    {
        $user = $request->user();

        if ($user === null) {
            return;
        }

        $path = $request->path();
        $key = 'audit-denied:'.$user->id.':'.sha1($request->method().' '.$path);

        // Cache::add succeeds once; the next five minutes of the same refusal
        // are one event, not thousands.
        if (! Cache::add($key, true, self::THROTTLE_SECONDS)) {
            return;
        }

        $this->audit->log($user, 'access_denied', null, [
            'method' => $request->method(),
            'path' => $path,
            'route' => $request->route()?->getName(),
        ]);
    }
}
