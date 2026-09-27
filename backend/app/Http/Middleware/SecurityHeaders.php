<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Security headers on every response (item 9).
 *
 * - Content-Security-Policy: applied to HTML responses only. The API serves
 *   JSON, where a CSP is dead weight, and a CSP on a JSON endpoint can break
 *   nothing but also protect nothing. The SPA build should carry the same
 *   policy from its own web server in production — see the summary note.
 * - X-Content-Type-Options: nosniff everywhere — cheap and strictly good.
 * - X-Frame-Options: DENY everywhere; the app is never legitimate framing
 *   content (clickjacking).
 * - Strict-Transport-Security: production only — sending it over localhost
 *   HTTP would make the browser refuse the app.
 *
 * Values live in config/security.php (env-overridable) so deployment can
 * tune them without a code change.
 */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', (string) config('security.headers.x_frame_options', 'DENY'));

        if ($this->shouldSendHsts()) {
            $response->headers->set(
                'Strict-Transport-Security',
                'max-age='.(int) config('security.headers.hsts_max_age', 31536000).'; includeSubDomains',
            );
        }

        if ($this->isHtml($response)) {
            $response->headers->set('Content-Security-Policy', (string) config('security.headers.csp'));
        }

        return $response;
    }

    /**
     * HSTS only when the app is production AND the request is https-capable
     * (APP_URL https). Never sent on localhost/HTTP — it would make the
     * browser refuse the app.
     */
    private function shouldSendHsts(): bool
    {
        if (config('security.headers.hsts_enabled') === false) {
            return false;
        }

        return app()->environment('production') || config('security.headers.hsts_enabled') === true;
    }

    /**
     * HTML responses (the framework's error pages, the welcome view) get the
     * CSP; JSON API responses do not need one.
     */
    private function isHtml(Response $response): bool
    {
        $type = (string) $response->headers->get('Content-Type');

        return str_contains($type, 'text/html');
    }
}
