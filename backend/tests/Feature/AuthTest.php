<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_users_can_register_and_receive_session(): void
    {
        $response = $this->postJson('/api/v1/register', [
            'name' => 'Kylle',
            'email' => 'kylle@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.email', 'kylle@example.com');

        $this->assertDatabaseHas('users', ['email' => 'kylle@example.com']);
    }

    public function test_registration_requires_a_strong_password(): void
    {
        $response = $this->postJson('/api/v1/register', [
            'name' => 'Weak',
            'email' => 'weak@example.com',
            'password' => 'password',
            'password_confirmation' => 'password',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['password']);
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

    public function test_users_cannot_login_with_invalid_credentials(): void
    {
        $user = User::factory()->create();

        $response = $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'wrong-password',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);
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
}
