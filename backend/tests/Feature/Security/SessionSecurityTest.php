<?php

namespace Tests\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * Item 1 — session & token management.
 *
 * Covers the happy paths (token issued with expiry, logout-all) and the
 * abuse cases: an expired token reused, a stale token beyond the idle
 * window, and sessions surviving a password change on another device.
 */
class SessionSecurityTest extends TestCase
{
    use RefreshDatabase;

    public function test_token_login_issues_a_token_with_absolute_expiry(): void
    {
        $user = User::factory()->create();

        $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'password',
            'device_name' => 'test-phone',
        ])->assertOk()->assertJsonStructure(['token']);

        $token = PersonalAccessToken::query()->latest('id')->first();

        $this->assertNotNull($token->expires_at, 'Token must carry an absolute expires_at (item 1).');
        $this->assertTrue(
            $token->expires_at->greaterThan(now()),
            'A freshly issued token must not already be expired.',
        );

        // Absolute lifetime comes from config('security.token_absolute').
        $this->assertSame(
            now()->addMinutes((int) config('security.token_absolute'))->format('Ymd'),
            $token->expires_at->format('Ymd'),
        );
    }

    public function test_an_expired_token_is_rejected(): void
    {
        $user = User::factory()->create();

        $plain = $this->plainToken($user);

        $token = PersonalAccessToken::query()->latest('id')->first();

        // Simulate the token having expired an hour ago.
        $token->forceFill(['expires_at' => now()->subHour()])->save();

        // Sanctum's Guard checks expires_at before the idle callback — an
        // expired token must not authenticate (abuse case: replaying an old
        // token after its absolute lifetime).
        $this->withToken($plain)
            ->getJson('/api/v1/user')
            ->assertUnauthorized();
    }

    public function test_a_token_past_the_idle_window_is_rejected(): void
    {
        $user = User::factory()->create();

        $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'password',
            'device_name' => 'test-phone',
        ])->assertOk();

        $token = PersonalAccessToken::query()->latest('id')->first();

        // Simulate inactivity: last used before the idle window.
        $token->forceFill([
            'last_used_at' => now()->subMinutes(config('security.token_idle') + 10),
        ])->save();

        // The idle callback rejects it even though expires_at is in the future.
        $token->refresh();
        $this->assertTrue($token->expires_at->isFuture());

        // findToken works off the hash; recompute the plain token for the call.
        // Instead of reversing the hash, assert via the callback directly.
        $this->assertFalse(
            \App\Services\Auth\IdleExpiringGuard::checkIdle($token, true),
            'A token idle past the window must fail the idle check.',
        );
    }

    public function test_a_recently_used_token_passes_the_idle_check(): void
    {
        $user = User::factory()->create();

        $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'password',
            'device_name' => 'test-phone',
        ])->assertOk();

        $token = PersonalAccessToken::query()->latest('id')->first();

        $this->assertTrue(\App\Services\Auth\IdleExpiringGuard::checkIdle($token, true));
    }

    public function test_logout_all_revokes_every_token_and_session(): void
    {
        $user = User::factory()->create();

        // Two mobile tokens.
        $this->postJson('/api/v1/token-login', [
            'email' => $user->email, 'password' => 'password', 'device_name' => 'phone-1',
        ])->assertOk();
        $this->postJson('/api/v1/token-login', [
            'email' => $user->email, 'password' => 'password', 'device_name' => 'phone-2',
        ])->assertOk();

        // Two cookie sessions (rows in the sessions table).
        DB::table('sessions')->insert([
            ['id' => 'sess-a', 'user_id' => $user->id, 'payload' => 'x', 'last_activity' => now()->timestamp],
            ['id' => 'sess-b', 'user_id' => $user->id, 'payload' => 'x', 'last_activity' => now()->timestamp],
        ]);

        $this->withToken($this->plainToken($user))
            ->postJson('/api/v1/logout-all')
            ->assertOk();

        $this->assertSame(0, $user->tokens()->count(), 'logout-all must revoke every token.');
        $remaining = DB::table('sessions')->where('user_id', $user->id)->count();
        $this->assertSame(0, $remaining, 'logout-all must destroy every cookie session.');
    }

    public function test_password_change_revokes_other_tokens(): void
    {
        $user = User::factory()->create();

        // The caller authenticates with a bearer token (the mobile path —
        // SPA password changes run through the same controller).
        $plain = $this->plainToken($user);

        // A second device holds another token.
        $this->postJson('/api/v1/token-login', [
            'email' => $user->email, 'password' => 'password', 'device_name' => 'other-device',
        ])->assertOk();
        $this->assertSame(2, $user->tokens()->count());

        $this->withToken($plain)
            ->patchJson('/api/v1/profile/password', [
                'current_password' => 'password',
                'password' => 'NewStr0ng-Pass!',
                'password_confirmation' => 'NewStr0ng-Pass!',
            ])->assertNoContent();

        // Only the CALLER's token survives; every other device is revoked.
        $this->assertSame(
            1,
            $user->tokens()->count(),
            'A password change must revoke every OTHER bearer token.',
        );
        $this->assertSame(
            'test-harness',
            $user->tokens()->first()->name,
            'The surviving token must be the device that proved the current password.',
        );

        // And the change is on the audit trail.
        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $user->id,
            'action' => 'password_changed',
        ]);
    }

    public function test_logout_all_requires_authentication(): void
    {
        $this->postJson('/api/v1/logout-all')->assertUnauthorized();
    }

    /**
     * Item 1, absolute session ceiling: a cookie session that never went
     * idle still dies SECURITY_SESSION_ABSOLUTE minutes after login.
     */
    public function test_a_fresh_cookie_session_passes_the_absolute_ceiling(): void
    {
        $user = User::factory()->create();

        $this->withHeaders(['Origin' => config('sanctum.stateful.0', 'http://localhost:5173')])
            ->postJson('/api/v1/login', [
                'identifier' => $user->email,
                'password' => 'password',
            ])->assertOk();

        // The login stamped the absolute clock...
        $this->assertTrue(
            $this->app['session.store']->has(\App\Http\Middleware\AbsoluteSessionExpiry::LOGIN_AT),
            'A cookie login must stamp login_at for the absolute ceiling.',
        );

        // ...and the young session authenticates fine.
        $this->actingAs($user)
            ->withHeaders(['Origin' => config('sanctum.stateful.0', 'http://localhost:5173')])
            ->getJson('/api/v1/user')
            ->assertOk();
    }

    public function test_a_cookie_session_past_the_absolute_ceiling_is_rejected(): void
    {
        $user = User::factory()->create();

        $this->withHeaders(['Origin' => config('sanctum.stateful.0', 'http://localhost:5173')])
            ->postJson('/api/v1/login', [
                'identifier' => $user->email,
                'password' => 'password',
            ])->assertOk();

        // Age the session BEYOND the absolute ceiling while keeping it fully
        // "active" — the point of the absolute ceiling is that activity does
        // not save it.
        $this->app['session.store']->put(
            \App\Http\Middleware\AbsoluteSessionExpiry::LOGIN_AT,
            now()->subMinutes(config('security.session_absolute') + 5)->toIso8601String(),
        );

        $this->actingAs($user)
            ->withHeaders(['Origin' => config('sanctum.stateful.0', 'http://localhost:5173')])
            ->getJson('/api/v1/user')
            ->assertStatus(401)
            ->assertJsonPath('message', 'Your session has expired. Please sign in again.');
    }

    /** Issue a token through the API and return its plain text. */
    private function plainToken(User $user): string
    {
        $response = $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'password',
            'device_name' => 'test-harness',
        ])->assertOk();

        return $this->extractPlainToken($response->json('token'));
    }

    /**
     * token-login returns 'id|plain'. withToken() wants the full string.
     * The response IS the full string; keep it verbatim.
     */
    private function extractPlainToken(string $jsonToken): string
    {
        return $jsonToken;
    }
}
