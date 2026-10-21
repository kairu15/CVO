<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_there_is_no_public_registration_endpoint(): void
    {
        // Accounts are staff-only, created by an administrator. The old
        // public /register route is gone — not throttled, not disabled:
        // removed. A caller who tries it gets a plain 404.
        $response = $this->postJson('/api/v1/register', [
            'name' => 'Kylle',
            'username' => 'kylle',
            'email' => 'kylle@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
        ]);

        $response->assertNotFound();

        $this->assertDatabaseMissing('users', ['email' => 'kylle@example.com']);
    }

    public function test_a_farmer_account_cannot_be_created_by_any_flow(): void
    {
        // The `farmer` role no longer exists in User::ROLES; the admin
        // create-account endpoint rejects it outright.
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)->postJson('/api/v1/admin/users', [
            'name' => 'Sneaky',
            'username' => 'sneaky',
            'email' => 'sneaky@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'role' => 'farmer',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['role']);

        $this->assertDatabaseMissing('users', ['email' => 'sneaky@example.com']);
    }

    public function test_users_can_login_with_valid_credentials(): void
    {
        $user = User::factory()->create();

        $response = $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'password',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.email', $user->email);
    }

    public function test_a_wrong_password_is_reported_against_the_password_field(): void
    {
        $user = User::factory()->create();

        $response = $this->postJson('/api/v1/login', [
            'identifier' => $user->email,
            'password' => 'wrong-password',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['password'])
            ->assertJsonPath('errors.password.0', 'Incorrect password.');
    }

    public function test_an_unknown_identifier_is_reported_as_not_found(): void
    {
        $response = $this->postJson('/api/v1/login', [
            'identifier' => 'ghost@example.com',
            'password' => 'whatever',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['identifier'])
            ->assertJsonPath('errors.identifier.0', 'No account found with that username or email.');
    }

    public function test_users_can_login_with_a_username(): void
    {
        $user = User::factory()->create(['username' => 'juan']);

        $response = $this->postJson('/api/v1/login', [
            'identifier' => 'JUAN',
            'password' => 'password',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.id', $user->id);
    }

    public function test_remember_me_issues_the_recaller_cookie_only_when_asked(): void
    {
        $user = User::factory()->create();

        // The SPA reaches the API from a stateful domain; only then does the
        // cookie session (and therefore the recaller) exist.
        $this->withHeaders(['Origin' => config('sanctum.stateful.0', 'http://localhost:5173')]);

        $recaller = app('auth')->guard('web')->getRecallerName();

        $plain = $this->postJson('/api/v1/login', [
            'identifier' => $user->email,
            'password' => 'password',
        ])->assertOk();

        $this->assertFalse(
            $this->hasCookie($plain, $recaller),
            'A plain login must not issue a remember-me recaller.',
        );

        $remembered = $this->postJson('/api/v1/login', [
            'identifier' => $user->email,
            'password' => 'password',
            'remember' => true,
        ])->assertOk();

        $this->assertTrue(
            $this->hasCookie($remembered, $recaller),
            'Remember me must issue the recaller cookie.',
        );
    }

    public function test_authenticated_user_can_be_fetched(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->getJson('/api/v1/user');

        $response->assertOk()
            ->assertJsonPath('data.email', $user->email);
    }

    public function test_guests_cannot_fetch_user_endpoint(): void
    {
        $this->getJson('/api/v1/user')->assertUnauthorized();
    }

    public function test_users_can_logout(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/v1/logout')
            ->assertOk();
    }

    public function test_mobile_clients_receive_a_bearer_token(): void
    {
        $user = User::factory()->create();

        $response = $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'password',
            'device_name' => 'android-phone',
        ]);

        $response->assertOk()
            ->assertJsonPath('user.email', $user->email)
            ->assertJsonStructure(['token']);
    }

    /** Whether a response set a cookie with the given name. */
    private function hasCookie(TestResponse $response, string $name): bool
    {
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === $name) {
                return true;
            }
        }

        return false;
    }
}
