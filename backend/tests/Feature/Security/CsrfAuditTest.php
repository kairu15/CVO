<?php

namespace Tests\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Item 4 — CSRF protection audit, expressed as tests so it cannot silently
 * regress.
 *
 * The architecture under test:
 * - statefulApi() (bootstrap/app.php) wraps /api routes in Sanctum's
 *   EnsureFrontendRequestsAreStateful. A request whose Origin/Referer matches
 *   SANCTUM_STATEFUL_DOMAINS gets the full session pipeline INCLUDING
 *   ValidateCsrfToken — a state-changing request from the SPA without the
 *   X-XSRF-TOKEN header is refused (419).
 * - A mobile (bearer-token) request has no Origin/Referer header, so
 *   fromFrontend() is false, the CSRF middleware never runs, and the token
 *   authenticates. Token-authenticated requests are therefore NOT
 *   csrf-protected by accident — they are correctly exempt, because bearer
 *   tokens are not ambient credentials (an attacker page cannot attach one).
 */
class CsrfAuditTest extends TestCase
{
    use RefreshDatabase;

    public function test_spa_origin_state_changing_requests_require_the_csrf_header(): void
    {
        $user = User::factory()->create();

        // This framework build short-circuits CSRF verification entirely while
        // running under phpunit (PreventRequestForgery::runningUnitTests), so
        // no feature test can observe a literal 419 by default. To exercise
        // the REAL gate, lift that short-circuit for this request only:
        // runningUnitTests() resolves environment('testing') off app['env'],
        // so pointing the container's env at production re-enables the
        // middleware's production behaviour.
        $previousEnv = $this->app['env'];
        $this->app['env'] = 'production';

        try {
            // Simulate the SPA: Origin from SANCTUM_STATEFUL_DOMAINS, but NO
            // X-XSRF-TOKEN header. fromFrontend() is true, so the stateful
            // pipeline (EncryptCookies, StartSession, ValidateCsrfToken,
            // AuthenticateSession) runs and must refuse the request before
            // any controller is reached (TokenMismatchException → 419).
            $response = $this->actingAs($user)
                ->withHeaders(['Origin' => config('sanctum.stateful.0', 'http://localhost:5173')])
                ->postJson('/api/v1/logout', []);

            $this->assertSame(
                419,
                $response->status(),
                'A state-changing request from the stateful SPA origin without a CSRF token must be refused.',
            );
        } finally {
            $this->app['env'] = $previousEnv;
        }
    }

    public function test_mobile_bearer_requests_are_exactly_exempt_from_csrf(): void
    {
        $user = User::factory()->create();
        $plain = $user->createToken('mobile')->plainTextToken;

        // No Origin/Referer header at all (native app) → not "from frontend"
        // → no CSRF middleware runs → the request proceeds on the token.
        $this->withToken($plain)
            ->postJson('/api/v1/logout', [])
            ->assertOk();
    }

    public function test_every_state_changing_route_is_inside_the_stateful_api_group(): void
    {
        // statefulApi() applies to the whole api route file; verify it is
        // actually configured (the structural guarantee items 4 rests on).
        $stateful = config('sanctum.stateful');
        $this->assertNotEmpty($stateful, 'SANCTUM_STATEFUL_DOMAINS must not be empty.');

        // And the API prefix resolves through the stateful middleware group.
        $group = $this->app->router->getMiddlewareGroups()['api'] ?? [];
        $this->assertContains(
            \Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful::class,
            $group,
            'The api middleware group must include Sanctum\'s stateful middleware.',
        );
    }

    public function test_safe_methods_do_not_require_csrf_even_from_the_spa_origin(): void
    {
        $user = User::factory()->create();

        // GETs are not CSRF-protectable events; they must work headerless
        // from the stateful origin (page load after login).
        $this->actingAs($user)
            ->withHeaders(['Origin' => config('sanctum.stateful.0', 'http://localhost:5173')])
            ->getJson('/api/v1/user')
            ->assertOk();
    }
}
