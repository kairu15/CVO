<?php

use App\Http\Middleware\AbsoluteSessionExpiry;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Enables Sanctum's stateful SPA auth (session + CSRF cookies)
        // for requests originating from SANCTUM_STATEFUL_DOMAINS.
        $middleware->statefulApi();

        // Absolute ceiling on cookie sessions (item 1): after
        // SECURITY_SESSION_ABSOLUTE minutes from login the session dies even
        // if it never went idle — SESSION_LIFETIME alone is renewed on every
        // request and would otherwise let an active session live forever.
        // Bearer tokens carry their own expires_at via Sanctum. APPENDED (not
        // prepended): it must run after EnsureFrontendRequestsAreStateful has
        // started the SPA's session, but before route middleware so an
        // expired session is refused before any controller or auth check.
        $middleware->api(append: [AbsoluteSessionExpiry::class]);

        // Security headers (CSP / XCTO / XFO / HSTS) on every response.
        $middleware->append(SecurityHeaders::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
