<?php

namespace Tests\Feature;

use App\Mail\PasswordResetOtpMail;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Password;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // The production routes are throttled. Clear the limiter here so the
        // attempt-limit test can make its five guesses without the request
        // limiter taking over the assertion.
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    public function test_known_email_gets_one_mail_and_only_the_hash_is_stored(): void
    {
        $user = User::factory()->create();
        $code = $this->requestCode($user);

        $row = DB::table('password_reset_otps')->where('email', $user->email)->first();

        $this->assertNotNull($row);
        $this->assertNotSame($code, $row->code_hash);
        $this->assertTrue(Hash::check($code, $row->code_hash));
        $this->assertSame(0, (int) $row->attempts);
        $this->assertTrue(now()->addMinutes(9)->lessThan($row->expires_at));
    }

    public function test_unknown_email_gets_the_same_response_and_no_mail(): void
    {
        Mail::fake();

        $this->postJson('/api/v1/forgot-password', ['email' => 'nobody@example.com'])
            ->assertOk()
            ->assertJsonPath(
                'message',
                'If that email address is in our records, a 6-digit reset code has been sent.',
            );

        Mail::assertNothingSent();
        $this->assertDatabaseMissing('password_reset_otps', ['email' => 'nobody@example.com']);
    }

    public function test_a_second_request_inside_the_resend_window_sends_nothing(): void
    {
        $user = User::factory()->create();
        Mail::fake();

        $this->postJson('/api/v1/forgot-password', ['email' => $user->email])->assertOk();
        $this->postJson('/api/v1/forgot-password', ['email' => $user->email])->assertOk();

        Mail::assertSent(PasswordResetOtpMail::class, 1);
    }

    public function test_a_verified_code_resets_the_password_and_revokes_tokens(): void
    {
        $user = User::factory()->create();
        $code = $this->requestCode($user);
        $user->createToken('phone');

        $ticket = $this->verifyCode($user, $code);

        // Verification alone must not change the password.
        $this->assertTrue(Hash::check('password', $user->fresh()->password));

        $this->postJson('/api/v1/reset-password', [
            'email' => $user->email,
            'reset_token' => $ticket,
            'password' => 'New-Pass-2!',
            'password_confirmation' => 'New-Pass-2!',
        ])->assertOk();

        $this->assertTrue(Hash::check('New-Pass-2!', $user->fresh()->password));
        $this->assertSame(0, $user->tokens()->count());
        $this->assertDatabaseMissing('password_reset_otps', ['email' => $user->email]);
        $this->assertDatabaseHas('activity_logs', [
            'action' => 'password_reset_completed',
            'actor_id' => $user->id,
        ]);
    }

    public function test_a_bare_otp_cannot_set_a_password_without_verification(): void
    {
        $user = User::factory()->create();
        $code = $this->requestCode($user);

        $this->postJson('/api/v1/reset-password', [
            'email' => $user->email,
            'otp' => $code,
            'password' => 'New-Pass-2!',
            'password_confirmation' => 'New-Pass-2!',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['reset_token']);

        // The password and the unused code are untouched.
        $this->assertTrue(Hash::check('password', $user->fresh()->password));
        $this->assertDatabaseHas('password_reset_otps', ['email' => $user->email]);
    }

    public function test_a_reset_ticket_is_single_use(): void
    {
        $user = User::factory()->create();
        $ticket = $this->verifyCode($user, $this->requestCode($user));

        $payload = [
            'email' => $user->email,
            'reset_token' => $ticket,
            'password' => 'New-Pass-2!',
            'password_confirmation' => 'New-Pass-2!',
        ];

        $this->postJson('/api/v1/reset-password', $payload)->assertOk();
        $this->postJson('/api/v1/reset-password', $payload)->assertUnprocessable()
            ->assertJsonValidationErrors(['reset_token']);
    }

    public function test_a_wrong_code_is_rejected_and_the_fifth_deletes_the_code(): void
    {
        $user = User::factory()->create();
        $code = $this->requestCode($user);
        $wrong = $code === '000000' ? '111111' : '000000';

        for ($attempt = 1; $attempt <= 4; $attempt++) {
            $this->postJson('/api/v1/verify-reset-code', [
                'email' => $user->email,
                'otp' => $wrong,
            ])->assertUnprocessable()
                ->assertJsonPath('errors.otp.0', 'That code is invalid or has expired. Request a new one.');

            $this->assertDatabaseHas('password_reset_otps', [
                'email' => $user->email,
                'attempts' => $attempt,
            ]);
        }

        $this->postJson('/api/v1/verify-reset-code', [
            'email' => $user->email,
            'otp' => $wrong,
        ])->assertUnprocessable();

        $this->assertDatabaseMissing('password_reset_otps', ['email' => $user->email]);
    }

    public function test_an_expired_code_cannot_be_used(): void
    {
        $user = User::factory()->create();
        $code = $this->requestCode($user);

        DB::table('password_reset_otps')->where('email', $user->email)->update([
            'expires_at' => now()->subMinute(),
        ]);

        $this->postJson('/api/v1/verify-reset-code', [
            'email' => $user->email,
            'otp' => $code,
        ])->assertUnprocessable();

        $this->assertDatabaseMissing('password_reset_otps', ['email' => $user->email]);
    }

    public function test_a_used_code_cannot_be_used_a_second_time(): void
    {
        $user = User::factory()->create();
        $code = $this->requestCode($user);

        $this->verifyCode($user, $code);

        $this->postJson('/api/v1/verify-reset-code', [
            'email' => $user->email,
            'otp' => $code,
        ])->assertUnprocessable();
    }

    public function test_a_malformed_code_gets_the_same_invalid_code_message(): void
    {
        $user = User::factory()->create();
        $this->requestCode($user);

        $this->postJson('/api/v1/verify-reset-code', [
            'email' => $user->email,
            'otp' => '12345',
        ])->assertUnprocessable()
            ->assertJsonPath('errors.otp.0', 'That code is invalid or has expired. Request a new one.');
    }

    public function test_the_email_is_branded_html_with_the_code_and_no_link(): void
    {
        $mail = new PasswordResetOtpMail('Jun Technician', '042913');
        $rendered = $mail->render();

        $this->assertSame('Your CVO password reset code', $mail->envelope()->subject);
        $this->assertStringContainsString('CVO Management System', $rendered);
        $this->assertStringContainsString('042913', $rendered);
        $this->assertStringContainsString('10 minutes', $rendered);
        $this->assertStringContainsString('Never share this code', $rendered);
        $this->assertStringContainsString('ignore this email', $rendered);
        $this->assertStringNotContainsString('http', $rendered);
    }

    public function test_password_policy_failures_are_validation_errors(): void
    {
        $user = User::factory()->create();
        $ticket = $this->verifyCode($user, $this->requestCode($user));

        $this->postJson('/api/v1/reset-password', [
            'email' => $user->email,
            'reset_token' => $ticket,
            'password' => 'weak',
            'password_confirmation' => 'weak',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['password']);

        // Validation failed before the ticket was consumed, so it still works.
        $this->postJson('/api/v1/reset-password', [
            'email' => $user->email,
            'reset_token' => $ticket,
            'password' => 'New-Pass-2!',
            'password_confirmation' => 'New-Pass-2!',
        ])->assertOk();
    }

    public function test_the_invite_token_path_still_works(): void
    {
        $user = User::factory()->create();
        $token = Password::createToken($user);

        $this->postJson('/api/v1/reset-password', [
            'token' => $token,
            'email' => $user->email,
            'password' => 'Invite-Pass-2!',
            'password_confirmation' => 'Invite-Pass-2!',
        ])->assertOk();

        $this->assertTrue(Hash::check('Invite-Pass-2!', $user->fresh()->password));
    }

    public function test_the_seeded_accounts_use_the_two_gmail_addresses_and_keep_their_rows(): void
    {
        $legacy = User::factory()->create([
            'username' => 'admin',
            'email' => 'admin@example.com',
            'role' => 'admin',
        ]);
        $legacyId = $legacy->id;

        $this->seed(DatabaseSeeder::class);

        $admin = User::where('username', 'admin')->firstOrFail();
        $technician = User::where('username', 'technician')->firstOrFail();

        $this->assertSame($legacyId, $admin->id);
        $this->assertSame('kylleacibron@gmail.com', $admin->email);
        $this->assertSame('samplekylleuser@gmail.com', $technician->email);
        $this->assertSame(2, User::withTrashed()->whereIn('username', ['admin', 'technician'])->count());
        $this->assertSame(0, User::withTrashed()->where('email', 'like', '%@example.com')->count());
    }

    /** Issue a code and return the plain value from the captured mailable. */
    private function requestCode(User $user): string
    {
        Mail::fake();
        $code = null;

        $this->postJson('/api/v1/forgot-password', ['email' => $user->email])->assertOk();

        Mail::assertSent(PasswordResetOtpMail::class, function (PasswordResetOtpMail $mail) use (&$code, $user): bool {
            $code = $mail->code;

            return $mail->hasTo($user->email);
        });

        $this->assertNotNull($code);

        return $code;
    }

    /** Verify a code and return the one-time reset ticket the API issued. */
    private function verifyCode(User $user, string $code): string
    {
        $response = $this->postJson('/api/v1/verify-reset-code', [
            'email' => $user->email,
            'otp' => $code,
        ])->assertOk();

        $ticket = $response->json('reset_token');

        $this->assertIsString($ticket);
        $this->assertNotEmpty($ticket);
        // The code itself is never echoed back.
        $this->assertNotSame($code, $ticket);

        return $ticket;
    }
}
