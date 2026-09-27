<?php

namespace Tests\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Item 9 — security headers. Also covers the item 10 regression guard:
 * every role dashboard endpoint must enforce its role server-side.
 */
class SecurityHeadersTest extends TestCase
{
    use RefreshDatabase;

    public function test_x_content_type_options_is_on_every_response(): void
    {
        $this->getJson('/api/v1/user')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_x_frame_options_is_on_every_response(): void
    {
        $this->getJson('/api/v1/user')
            ->assertHeader('X-Frame-Options', 'DENY');
    }

    public function test_csp_is_applied_to_html_responses(): void
    {
        $response = $this->get('/');

        $response->assertOk();

        $csp = $response->headers->get('Content-Security-Policy');
        $this->assertNotNull($csp, 'HTML responses must carry a CSP.');
        $this->assertStringContainsString("default-src 'self'", $csp);
        $this->assertStringContainsString("frame-ancestors 'none'", $csp);
    }

    public function test_hsts_is_absent_outside_production(): void
    {
        // The test env is not production: HSTS must NOT be sent (it would
        // poison localhost browsers).
        $this->getJson('/api/v1/user')
            ->assertHeaderMissing('Strict-Transport-Security');
    }

    public function test_hsts_is_sent_when_forced_on(): void
    {
        // e.g. a staging host behind real TLS: SECURITY_HSTS=true forces the
        // header outside production.
        config(['security.headers.hsts_enabled' => true]);

        $response = $this->getJson('/api/v1/user');

        $hsts = $response->headers->get('Strict-Transport-Security');
        $this->assertNotNull($hsts);
        $this->assertStringContainsString('max-age=', $hsts);
        $this->assertStringContainsString('includeSubDomains', $hsts);
    }
}

/**
 * Item 10 — server-side role enforcement regression guard.
 *
 * The SPA's RoleRoute is a UX boundary, not a security one: these tests pin
 * the SERVER-side answer for each role's data plane, so a hand-crafted
 * request can never read another dashboard's rows just because the SPA
 * would never render the link.
 */
class ServerSideRoleEnforcementTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_endpoints_reject_every_non_admin_role(): void
    {
        $routes = [
            '/api/v1/admin/users',
            '/api/v1/admin/beneficiaries',
            '/api/v1/admin/report',
            '/api/v1/admin/settings',
            '/api/v1/admin/activity-logs',
        ];

        foreach (['doctor', 'technician', 'farmer'] as $role) {
            $user = User::factory()->create(['role' => $role]);

            foreach ($routes as $route) {
                $this->actingAs($user)
                    ->getJson($route)
                    ->assertForbidden("{$role} must be forbidden on {$route} (server-side, not just in the SPA).");
            }
        }
    }

    public function test_doctor_writes_are_rejected_for_other_roles(): void
    {
        $beneficiary = \App\Models\Beneficiary::factory()->create();

        foreach (['technician', 'farmer'] as $role) {
            $user = User::factory()->create(['role' => $role]);

            $this->actingAs($user)
                ->postJson('/api/v1/health-records', [
                    'beneficiary_id' => $beneficiary->id,
                    'date_recorded' => '2026-09-27',
                    'diagnosis' => 'hernia',
                    'treatment' => 'surgery',
                ])->assertForbidden();
        }
    }

    public function test_technician_visits_are_rejected_for_other_roles(): void
    {
        $beneficiary = \App\Models\Beneficiary::factory()->create();

        foreach (['doctor', 'farmer'] as $role) {
            $user = User::factory()->create(['role' => $role]);

            $this->actingAs($user)
                ->postJson('/api/v1/field-visits', [
                    'beneficiary_id' => $beneficiary->id,
                    'visited_on' => '2026-09-27',
                    'purpose' => 'routine-monitoring',
                ])->assertForbidden();
        }
    }

    public function test_role_scoping_hides_other_rows_even_for_valid_ids(): void
    {
        // A farmer pointing at a beneficiary they do not own gets 404 —
        // the row is scoped out at the QUERY level, not filtered client-side.
        $farmer = User::factory()->create(['role' => 'farmer']);
        $other = \App\Models\Beneficiary::factory()->create(); // belongs to someone else

        $this->actingAs($farmer)
            ->getJson("/api/v1/beneficiaries/{$other->id}")
            ->assertNotFound();
    }
}
