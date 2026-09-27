<?php

namespace Tests\Feature\Security;

use App\Models\ActivityLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Item 2 — per-account lockout on top of the 6/min route throttle.
 *
 * The throttle stops a single IP hammering the endpoint; the lockout stops
 * a distributed attempt against ONE account. Tests cover the happy path
 * (successful login resets the counter) and the abuse path (N consecutive
 * failures lock the account, wrong password stays rejected during the
 * cooldown, the lock is audited).
 *
 * The tests manipulate the cache directly rather than sleeping through the
 * cooldown, and raise the throttle limit so the 6/min IP throttle does not
 * mask the per-account behaviour under test.
 */
class AccountLockoutTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Deterministic lockout config for the tests.
        config([
            'security.lockout.max_attempts' => 3,
            'security.lockout.lockout_minutes' => 15,
            'security.lockout.window_minutes' => 60,
        ]);
    }

    public function test_failed_attempts_below_the_threshold_do_not_lock(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('Correct-Horse1!'),
        ]);

        for ($i = 0; $i < 2; $i++) {
            $this->postJson('/api/v1/token-login', [
                'email' => $user->email,
                'password' => 'wrong-password',
                'device_name' => 'test-phone',
            ])->assertUnprocessable();
        }

        // A correct password still works: no lockout below the threshold.
        $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'Correct-Horse1!',
            'device_name' => 'test-phone',
        ])->assertOk();
    }

    public function test_consecutive_failures_lock_the_account(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('Correct-Horse1!'),
        ]);

        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/v1/token-login', [
                'email' => $user->email,
                'password' => 'wrong-password',
                'device_name' => 'test-phone',
            ])->assertUnprocessable();
        }

        // The lock is in place...
        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $user->id,
            'action' => 'account_locked',
        ]);

        // ...and now even the CORRECT password is refused with 423.
        $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'Correct-Horse1!',
            'device_name' => 'test-phone',
        ])->assertStatus(423)
            ->assertJsonPath('message', 'Too many failed attempts. Try again later.');
    }

    public function test_locked_account_answers_423_with_retry_after(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('Correct-Horse1!'),
        ]);

        $lockout = app(\App\Services\Auth\AccountLockout::class);
        $lockout->recordFailure($user);
        $lockout->recordFailure($user);
        $lockout->recordFailure($user);

        $response = $this->postJson('/api/v1/login', [
            'identifier' => $user->email,
            'password' => 'Correct-Horse1!',
        ]);

        $response->assertStatus(423);
        $this->assertNotNull($response->headers->get('Retry-After'));
        $this->assertGreaterThan(0, (int) $response->headers->get('Retry-After'));
    }

    public function test_the_lock_expires_after_the_cooldown(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('Correct-Horse1!'),
        ]);

        $lockout = app(\App\Services\Auth\AccountLockout::class);
        $lockout->recordFailure($user);
        $lockout->recordFailure($user);
        $lockout->recordFailure($user);

        $this->assertTrue($lockout->isLocked($user));

        // Travel past the cooldown.
        $this->travel(config('security.lockout.lockout_minutes') + 1)->minutes();

        $this->assertFalse($lockout->isLocked($user));

        $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'Correct-Horse1!',
            'device_name' => 'test-phone',
        ])->assertOk();
    }

    public function test_a_successful_login_resets_the_failure_count(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('Correct-Horse1!'),
        ]);

        $lockout = app(\App\Services\Auth\AccountLockout::class);

        // Two failures, then a success, then two more — never three in a row.
        $lockout->recordFailure($user);
        $lockout->recordFailure($user);

        $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'Correct-Horse1!',
            'device_name' => 'test-phone',
        ])->assertOk();

        $this->assertSame(0, (int) \Illuminate\Support\Facades\Cache::get(
            \App\Services\Auth\AccountLockout::counterKey($user->id),
            0,
        ));

        $lockout->recordFailure($user);
        $lockout->recordFailure($user);

        // Still not locked — the counter was reset by the success.
        $this->assertFalse($lockout->isLocked($user));
    }

    public function test_unknown_identifiers_are_never_locked_or_enumerated(): void
    {
        // A few failures against a non-existent account (kept under the
        // 6/min route throttle so the throttle is not what answers).
        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/v1/token-login', [
                'email' => 'ghost@example.com',
                'password' => 'whatever',
                'device_name' => 'test-phone',
            ])->assertUnprocessable();
        }

        // No lockout row can exist — there is no account to attribute it to.
        $this->assertSame(0, ActivityLog::query()->where('action', 'account_locked')->count());
    }

    public function test_lockout_is_audited_with_attempt_count(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('Correct-Horse1!'),
        ]);

        // Drive the counter through the service directly — the endpoint path
        // is covered by the other tests; here we assert the audit payload.
        $lockout = app(\App\Services\Auth\AccountLockout::class);
        $lockout->recordFailure($user);
        $lockout->recordFailure($user);
        $lockout->recordFailure($user);

        $row = ActivityLog::query()
            ->where('actor_id', $user->id)
            ->where('action', 'account_locked')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame(3, $row->context['failed_attempts']);
        $this->assertSame(15, $row->context['locked_minutes']);
    }
}
