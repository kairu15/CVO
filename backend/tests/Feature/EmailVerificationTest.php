<?php

namespace Tests\Feature;

use App\Mail\PasswordResetOtpMail;
use App\Mail\StaffEmailVerificationMail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Staff email verification and its hand-off to password recovery.
 *
 * The workflow these tests protect:
 *   admin creates a staff account -> pending verification, no sign-in
 *   owner opens the emailed link    -> verified, token consumed
 *   owner sets/receives a password  -> OTP recovery works from now on
 */
class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Mail::fake();
    }

    /**
     * Create a staff account through the real admin endpoint and return
     * [admin, user, raw verification token].
     *
     * @return array{0: User, 1: User, 2: string}
     */
    private function createStaff(array $overrides = []): array
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $email = $overrides['email'] ?? Str::lower(Str::random(8)).'@example.com';

        $this->actingAs($admin)
            ->postJson('/api/v1/admin/users', array_merge([
                'name' => 'Staff Member',
                'email' => $email,
                'role' => 'technician',
                'password' => 'Str0ng!Pass',
                'password_confirmation' => 'Str0ng!Pass',
            ], $overrides))
            ->assertCreated();

        $user = User::query()->where('email', $email)->firstOrFail();

        return [$admin, $user, $this->verificationTokenFor($email)];
    }

    /** Token from the most recent verification email to this address. */
    private function verificationTokenFor(string $email): string
    {
        $url = null;

        Mail::assertSent(StaffEmailVerificationMail::class, function (StaffEmailVerificationMail $mail) use ($email, &$url): bool {
            if (! $mail->hasTo($email)) {
                return false;
            }

            $url = $mail->verificationUrl;

            return true;
        });

        $this->assertNotNull($url, 'No verification email was sent.');

        parse_str((string) parse_url((string) $url, PHP_URL_QUERY), $query);
        $this->assertArrayHasKey('token', $query);

        return $query['token'];
    }

    public function test_a_new_account_is_pending_and_cannot_sign_in_until_verified(): void
    {
        [$admin, $user] = $this->createStaff(['email' => 'new.tech@example.com']);

        $this->assertNull($user->email_verified_at);
        $this->assertSame('pending', $user->verificationStatus());

        Mail::assertSent(StaffEmailVerificationMail::class, function (StaffEmailVerificationMail $mail): bool {
            return $mail->hasTo('new.tech@example.com')
                && $mail->recipientEmail === 'new.tech@example.com'
                && $mail->expiresInHours === 24;
        });

        // The admin list reports the pending state.
        $row = collect(
            $this->actingAs($admin)
                ->getJson('/api/v1/admin/users?status=all')
                ->assertOk()
                ->json('data'),
        )->firstWhere('id', $user->id);

        $this->assertSame('pending', $row['verification_status']);
        $this->assertNull($row['email_verified_at']);

        // Correct password or not, an unverified account is refused.
        $this->postJson('/api/v1/login', [
            'identifier' => 'new.tech@example.com',
            'password' => 'Str0ng!Pass',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['identifier'])
            ->assertJsonPath(
                'errors.identifier.0',
                'Verify your email address before signing in. Check your inbox for the verification link, or ask a CVO administrator to resend it.',
            );

        $this->assertDatabaseMissing('activity_logs', [
            'actor_id' => $user->id,
            'action' => 'login',
        ]);
    }

    public function test_the_emailed_link_verifies_the_address_and_cannot_be_reused(): void
    {
        [, $user, $token] = $this->createStaff(['email' => 'verify.me@example.com']);

        $this->postJson('/api/v1/email/verify', ['token' => $token])
            ->assertOk()
            ->assertJsonPath('data.email', 'verify.me@example.com');

        $this->assertNotNull($user->refresh()->email_verified_at);
        $this->assertDatabaseMissing('email_verification_tokens', ['user_id' => $user->id]);
        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $user->id,
            'action' => 'email_verified',
            'target_id' => $user->id,
        ]);

        // A used link is dead.
        $this->postJson('/api/v1/email/verify', ['token' => $token])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['token']);

        // And the account can now sign in.
        $this->postJson('/api/v1/login', [
            'identifier' => 'verify.me@example.com',
            'password' => 'Str0ng!Pass',
        ])->assertOk()->assertJsonPath('data.email', 'verify.me@example.com');
    }

    public function test_an_expired_link_is_refused_and_the_row_is_removed(): void
    {
        [, $user, $token] = $this->createStaff(['email' => 'expired.link@example.com']);

        DB::table('email_verification_tokens')
            ->where('user_id', $user->id)
            ->update(['expires_at' => now()->subMinute()]);

        $this->postJson('/api/v1/email/verify', ['token' => $token])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['token']);

        $this->assertNull($user->refresh()->email_verified_at);
        $this->assertDatabaseMissing('email_verification_tokens', ['user_id' => $user->id]);
        $this->assertSame('expired', $user->fresh()->verificationStatus());
    }

    public function test_an_unknown_token_is_refused(): void
    {
        $this->postJson('/api/v1/email/verify', ['token' => Str::random(64)])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['token']);

        $this->postJson('/api/v1/email/verify', ['token' => ''])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['token']);
    }

    public function test_resending_rotates_the_token_and_invalidates_the_previous_link(): void
    {
        [$admin, $user, $firstToken] = $this->createStaff(['email' => 'resend.me@example.com']);

        $this->actingAs($admin)
            ->postJson("/api/v1/admin/users/{$user->id}/verification-email")
            ->assertOk()
            ->assertJsonPath('data.email_sent', true)
            ->assertJsonPath('data.email', 'resend.me@example.com');

        $secondToken = $this->verificationTokenFor('resend.me@example.com');

        $this->assertNotSame($firstToken, $secondToken);

        // The link from the first email is now dead...
        $this->postJson('/api/v1/email/verify', ['token' => $firstToken])
            ->assertUnprocessable();

        // ...and the newest one works.
        $this->postJson('/api/v1/email/verify', ['token' => $secondToken])
            ->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $admin->id,
            'action' => 'verification_email_sent',
            'target_id' => $user->id,
        ]);
    }

    public function test_resending_is_refused_for_an_already_verified_account(): void
    {
        [$admin, $user] = $this->createStaff(['email' => 'already.verified@example.com']);

        $user->forceFill(['email_verified_at' => now()])->save();

        $this->actingAs($admin)
            ->postJson("/api/v1/admin/users/{$user->id}/verification-email")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['user']);
    }

    public function test_a_disabled_account_cannot_verify_its_email(): void
    {
        [$admin, $user, $token] = $this->createStaff(['email' => 'disabled.account@example.com']);

        $this->actingAs($admin)
            ->deleteJson("/api/v1/admin/users/{$user->id}")
            ->assertOk();

        $this->postJson('/api/v1/email/verify', ['token' => $token])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['token']);

        $this->assertNull(User::withTrashed()->findOrFail($user->id)->email_verified_at);
    }

    public function test_only_an_administrator_can_resend_a_verification_email(): void
    {
        [, $user] = $this->createStaff(['email' => 'not.admin@example.com']);

        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($technician)
            ->postJson("/api/v1/admin/users/{$user->id}/verification-email")
            ->assertForbidden();
    }

    public function test_unverified_forgot_password_sends_a_verification_email_instead_of_an_otp(): void
    {
        [, $user] = $this->createStaff(['email' => 'unverified.recovery@example.com']);

        $this->postJson('/api/v1/forgot-password', ['email' => 'unverified.recovery@example.com'])
            ->assertOk()
            ->assertJsonPath(
                'message',
                'If that email address is in our records, a 6-digit reset code has been sent.',
            );

        // No OTP exists and none was emailed; the verification mail went out
        // again instead, with a fresh token.
        $this->assertDatabaseCount('password_reset_otps', 0);
        Mail::assertNotSent(PasswordResetOtpMail::class);
        Mail::assertSent(StaffEmailVerificationMail::class, function (StaffEmailVerificationMail $mail): bool {
            return $mail->hasTo('unverified.recovery@example.com');
        });

        $this->assertNull($user->refresh()->email_verified_at);
    }

    public function test_after_verification_the_full_otp_recovery_flow_works(): void
    {
        [, $user, $token] = $this->createStaff(['email' => 'recovery.flow@example.com']);

        $this->postJson('/api/v1/email/verify', ['token' => $token])->assertOk();

        $this->postJson('/api/v1/forgot-password', ['email' => 'recovery.flow@example.com'])
            ->assertOk();

        $code = null;
        Mail::assertSent(PasswordResetOtpMail::class, function (PasswordResetOtpMail $mail) use (&$code): bool {
            $code = $mail->code;

            return true;
        });

        $this->assertNotNull($code);
        $this->assertSame(6, strlen($code));

        $resetToken = $this->postJson('/api/v1/verify-reset-code', [
            'email' => 'recovery.flow@example.com',
            'otp' => $code,
        ])->assertOk()->json('reset_token');

        $this->postJson('/api/v1/reset-password', [
            'email' => 'recovery.flow@example.com',
            'reset_token' => $resetToken,
            'password' => 'NewOwn!Pass2',
            'password_confirmation' => 'NewOwn!Pass2',
        ])->assertOk();

        $this->postJson('/api/v1/login', [
            'identifier' => 'recovery.flow@example.com',
            'password' => 'NewOwn!Pass2',
        ])->assertOk();
    }
}
