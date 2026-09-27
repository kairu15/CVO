<?php

namespace Tests\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Tests\TestCase;

/**
 * Item 3 — password reset / recovery.
 *
 * Happy path: a reset link request creates a token and the reset completes,
 * revoking existing sessions. Abuse cases: an expired token is refused, a
 * token is single-use, and the endpoint NEVER reveals whether an email
 * exists.
 */
class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_reset_link_can_be_requested_and_used(): void
    {
        $user = User::factory()->create(['password' => Hash::make('Old-Pass-1!')]);

        $this->postJson('/api/v1/forgot-password', ['email' => $user->email])
            ->assertOk()
            ->assertJsonPath('message', 'If that email address is in our records, a password reset link has been sent.');

        // The broker stored a hashed token.
        $this->assertDatabaseHas('password_reset_tokens', ['email' => $user->email]);

        // Complete the reset with the token the notification carried.
        $token = $this->brokerToken($user);

        $this->postJson('/api/v1/reset-password', [
            'token' => $token,
            'email' => $user->email,
            'password' => 'New-Pass-2!',
            'password_confirmation' => 'New-Pass-2!',
        ])->assertOk();

        $this->assertTrue(Hash::check('New-Pass-2!', $user->refresh()->password));

        // Single-use: the token row is gone after success.
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => $user->email]);
    }

    public function test_the_response_never_reveals_whether_an_email_exists(): void
    {
        Notification::fake(); // silence mail, not the broker

        $real = User::factory()->create()->email;

        $known = $this->postJson('/api/v1/forgot-password', ['email' => $real]);
        $unknown = $this->postJson('/api/v1/forgot-password', ['email' => 'nobody@example.com']);

        $known->assertOk();
        $unknown->assertOk();

        // Identical status code AND identical body — no oracle.
        $this->assertSame(
            $known->json('message'),
            $unknown->json('message'),
        );

        // And nothing was written for the unknown address.
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => 'nobody@example.com']);
    }

    public function test_an_expired_token_is_refused(): void
    {
        $user = User::factory()->create();

        // Mint the token first, then age the stored record past the expiry
        // window (auth.passwords.users.expire) before attempting the reset.
        $token = $this->brokerToken($user);

        DB::table('password_reset_tokens')
            ->where('email', $user->email)
            ->update(['created_at' => now()->subMinutes((int) config('auth.passwords.users.expire') + 5)]);

        $this->postJson('/api/v1/reset-password', [
            'token' => $token,
            'email' => $user->email,
            'password' => 'New-Pass-2!',
            'password_confirmation' => 'New-Pass-2!',
        ])->assertStatus(422);

        // The password is unchanged.
        $this->assertTrue(Hash::check('password', $user->refresh()->password));
    }

    public function test_a_token_cannot_be_reused(): void
    {
        Notification::fake();

        $user = User::factory()->create();

        $this->postJson('/api/v1/forgot-password', ['email' => $user->email])->assertOk();
        $token = $this->brokerToken($user);

        $payload = [
            'token' => $token,
            'email' => $user->email,
            'password' => 'New-Pass-2!',
            'password_confirmation' => 'New-Pass-2!',
        ];

        $this->postJson('/api/v1/reset-password', $payload)->assertOk();

        // Second use of the same token must fail.
        $this->postJson('/api/v1/reset-password', $payload)->assertStatus(422);
    }

    public function test_a_successful_reset_revokes_existing_sessions_and_tokens(): void
    {
        $user = User::factory()->create();

        // An attacker holds a token/session from before the reset.
        $this->postJson('/api/v1/token-login', [
            'email' => $user->email, 'password' => 'password', 'device_name' => 'stolen-phone',
        ])->assertOk();

        $this->postJson('/api/v1/forgot-password', ['email' => $user->email])->assertOk();
        $token = $this->brokerToken($user);

        $this->postJson('/api/v1/reset-password', [
            'token' => $token,
            'email' => $user->email,
            'password' => 'New-Pass-2!',
            'password_confirmation' => 'New-Pass-2!',
        ])->assertOk();

        // Forced re-authentication: every bearer token died.
        $this->assertSame(0, $user->tokens()->count());

        // ...and the completion is audited.
        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $user->id,
            'action' => 'password_reset_completed',
        ]);
    }

    public function test_reset_validates_the_password_policy(): void
    {
        $user = User::factory()->create();

        $this->postJson('/api/v1/forgot-password', ['email' => $user->email])->assertOk();
        $token = $this->brokerToken($user);

        $this->postJson('/api/v1/reset-password', [
            'token' => $token,
            'email' => $user->email,
            'password' => 'weak',
            'password_confirmation' => 'weak',
        ])->assertUnprocessable()->assertJsonValidationErrors('password');
    }

    public function test_reset_requests_are_throttled(): void
    {
        $user = User::factory()->create();

        // The broker's own per-address throttle (auth.passwords.users.throttle,
        // 60s): after the first request, a second within the window is
        // refused with the uniform response — no token is minted.
        $this->postJson('/api/v1/forgot-password', ['email' => $user->email])->assertOk();

        $first = DB::table('password_reset_tokens')->where('email', $user->email)->first();

        $this->postJson('/api/v1/forgot-password', ['email' => $user->email])->assertOk();

        $second = DB::table('password_reset_tokens')->where('email', $user->email)->first();

        // The record is unchanged — RESET_THROTTLED, no new token.
        $this->assertSame($first->token, $second->token);
    }

    /**
     * Mint a plain token via the broker's own repository — the exact path
     * sendResetLink uses — so the test holds a valid, correctly-hashed
     * credential without having to parse the mail body.
     */
    private function brokerToken(User $user): string
    {
        /** @var \Illuminate\Auth\Passwords\DatabaseTokenRepository $repository */
        $repository = Password::broker()->getRepository();

        return $repository->create($user);
    }
}
