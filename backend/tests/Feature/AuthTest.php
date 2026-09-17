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
            'username' => 'kylle',
            'email' => 'kylle@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.email', 'kylle@example.com')
            ->assertJsonPath('data.username', 'kylle')
            ->assertJsonPath('data.role', 'farmer');

        $this->assertDatabaseHas('users', [
            'email' => 'kylle@example.com',
            'role' => 'farmer',
        ]);
    }

    public function test_self_registration_always_creates_a_farmer(): void
    {
        $response = $this->postJson('/api/v1/register', [
            'name' => 'Sneaky',
            'username' => 'sneaky',
            'email' => 'sneaky@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'role' => 'admin',
        ]);

        $response->assertCreated()->assertJsonPath('data.role', 'farmer');

        $this->assertDatabaseMissing('users', ['email' => 'sneaky@example.com', 'role' => 'admin']);
    }

    public function test_registration_requires_a_unique_username(): void
    {
        User::factory()->create(['username' => 'taken']);

        $response = $this->postJson('/api/v1/register', [
            'name' => 'Copycat',
            'username' => 'taken',
            'email' => 'copycat@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['username']);
    }

    public function test_registration_requires_a_strong_password(): void
    {
        $response = $this->postJson('/api/v1/register', [
            'name' => 'Weak',
            'username' => 'weak',
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
            'identifier' => $user->email,
            'password' => 'wrong-password',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['identifier']);
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
