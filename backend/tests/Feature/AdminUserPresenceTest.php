<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Presence on the User Management screen.
 *
 * Presence is a different question from account status: `status` says whether
 * the account is enabled, `presence` says whether somebody is signed in and
 * using it now. The rule lives in App\Support\Presence; these tests cover the
 * three ways it reaches the app (middleware, scopes, resource) plus the
 * boundary cases: the window, sign-out, deactivation and dead tokens.
 *
 * Session driver note: phpunit.xml runs the `array` driver, which stores no
 * session rows. Tests that need to prove a *revoked* session/token reads
 * offline switch to the `database` driver — the production shape — where a
 * missing session row is meaningful evidence.
 */
class AdminUserPresenceTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        // Already seen a moment ago: the activity middleware stamps after the
        // response is built, so this is the value the request itself sees.
        return User::factory()->create(['role' => 'admin', 'last_seen_at' => now()]);
    }

    /** The row for one account, as the admin table would receive it. */
    private function rowFor(User $admin, User $target): array
    {
        $rows = $this->actingAs($admin)
            ->getJson('/api/v1/admin/users?status=all')
            ->assertOk()
            ->json('data');

        foreach ($rows as $row) {
            if ($row['id'] === $target->id) {
                return $row;
            }
        }

        $this->fail("No user row returned for account {$target->id}.");
    }

    public function test_a_request_stamps_last_seen_at_once_per_minute(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'last_seen_at' => null]);
        $this->assertNull($admin->fresh()->last_seen_at);

        $this->actingAs($admin)->getJson('/api/v1/user')->assertOk();

        $first = $admin->fresh()->last_seen_at;
        $this->assertNotNull($first, 'An authenticated request should stamp last_seen_at.');

        // Inside the throttle: the stored value must not move.
        $this->travel(30)->seconds();
        $this->actingAs($admin)->getJson('/api/v1/user')->assertOk();
        $this->assertTrue(
            $first->equalTo($admin->fresh()->last_seen_at),
            'A second request inside a minute must not write again.',
        );

        // Past the throttle: it moves.
        $this->travel(40)->seconds();
        $this->actingAs($admin)->getJson('/api/v1/user')->assertOk();
        $this->assertTrue($admin->fresh()->last_seen_at->gt($first));
    }

    public function test_signing_in_stamps_last_seen_at(): void
    {
        $user = User::factory()->create([
            'role' => 'admin',
            'password' => Hash::make('Str0ng!Pass'),
            'last_seen_at' => null,
        ]);

        $this->postJson('/api/v1/login', [
            'identifier' => $user->email,
            'password' => 'Str0ng!Pass',
        ])->assertOk();

        $this->assertNotNull($user->fresh()->last_seen_at);
    }

    public function test_a_user_inside_the_window_is_online_and_one_outside_is_offline(): void
    {
        $admin = $this->admin();
        $recent = User::factory()->create(['last_seen_at' => now()->subMinutes(2)]);
        $stale = User::factory()->create(['last_seen_at' => now()->subMinutes(30)]);

        $this->assertSame('online', $this->rowFor($admin, $recent)['presence']);
        $this->assertSame('offline', $this->rowFor($admin, $stale)['presence']);
    }

    public function test_signing_out_reads_offline_immediately(): void
    {
        $admin = $this->admin();
        $technician = User::factory()->create(['role' => 'technician', 'last_seen_at' => now()]);

        $this->assertSame('online', $this->rowFor($admin, $technician)['presence']);

        $this->actingAs($technician)->postJson('/api/v1/logout')->assertOk();

        $this->assertSame('offline', $this->rowFor($admin, $technician)['presence']);
        // The last-seen stamp survives the sign-out, so the table can still
        // say when they were last around.
        $this->assertNotNull($technician->fresh()->last_seen_at);
    }

    public function test_a_deactivated_account_is_never_online(): void
    {
        $admin = $this->admin();
        $gone = User::factory()->create(['last_seen_at' => now()]);

        $gone->delete();

        $row = $this->rowFor($admin, $gone);

        $this->assertSame('deactivated', $row['status']);
        $this->assertSame('offline', $row['presence']);
    }

    public function test_a_live_token_keeps_the_account_online(): void
    {
        $admin = $this->admin();
        $mobile = User::factory()->create(['last_seen_at' => now()]);
        $mobile->createToken('phone', ['*'], now()->addHour());

        $this->assertSame('online', $this->rowFor($admin, $mobile)['presence']);
    }

    public function test_an_expired_token_reads_offline(): void
    {
        $admin = $this->admin();
        $mobile = User::factory()->create(['last_seen_at' => now()]);
        $token = $mobile->createToken('phone', ['*'], now()->addHour());

        // Present but past its absolute expiry: a dead credential.
        $token->accessToken->forceFill(['expires_at' => now()->subMinute()])->save();

        $this->assertSame('offline', $this->rowFor($admin, $mobile)['presence']);
    }

    public function test_a_revoked_token_reads_offline_when_sessions_are_server_side(): void
    {
        // Production shape: cookie sessions live in the `sessions` table, so
        // "no live session and no live token" really is offline.
        config(['session.driver' => 'database']);

        $admin = $this->admin();
        $mobile = User::factory()->create(['last_seen_at' => now()]);
        $token = $mobile->createToken('phone', ['*'], now()->addHour());

        $this->assertSame('online', $this->rowFor($admin, $mobile)['presence']);

        $token->accessToken->delete();

        $this->assertSame('offline', $this->rowFor($admin, $mobile)['presence']);
    }

    public function test_the_presence_filter_and_online_count_use_the_same_rule(): void
    {
        $admin = $this->admin();
        $online = User::factory()->create(['last_seen_at' => now()]);
        $offline = User::factory()->create(['last_seen_at' => now()->subHours(3)]);

        $response = $this->actingAs($admin)
            ->getJson('/api/v1/admin/users?presence=online')
            ->assertOk();

        $ids = array_column($response->json('data'), 'id');

        $this->assertContains($online->id, $ids);
        $this->assertNotContains($offline->id, $ids);
        // The admin making the request has just been stamped as active.
        $this->assertContains($admin->id, $ids);

        $this->assertSame(
            count($ids),
            $response->json('summary.online'),
            'The summary count must agree with the filtered rows.',
        );

        $offlineResponse = $this->actingAs($admin)
            ->getJson('/api/v1/admin/users?presence=offline')
            ->assertOk();

        $offlineIds = array_column($offlineResponse->json('data'), 'id');

        $this->assertContains($offline->id, $offlineIds);
        $this->assertNotContains($online->id, $offlineIds);
    }

    public function test_the_online_count_ignores_the_presence_filter(): void
    {
        $admin = $this->admin();
        User::factory()->create(['last_seen_at' => now()]);
        User::factory()->create(['last_seen_at' => now()->subHours(3)]);

        $all = $this->actingAs($admin)->getJson('/api/v1/admin/users?status=all')->assertOk();
        $offlineOnly = $this->actingAs($admin)
            ->getJson('/api/v1/admin/users?status=all&presence=offline')
            ->assertOk();

        $this->assertSame(
            $all->json('summary.online'),
            $offlineOnly->json('summary.online'),
            '"N online" describes the filter set, not the presence filter itself.',
        );
    }

    public function test_presence_is_withheld_from_roles_that_cannot_see_the_user_list(): void
    {
        $technician = User::factory()->create(['role' => 'technician', 'last_seen_at' => now()]);

        $response = $this->actingAs($technician)->getJson('/api/v1/user')->assertOk();

        $this->assertArrayNotHasKey('presence', $response->json('data'));
        $this->assertArrayNotHasKey('last_seen_at', $response->json('data'));

        // ...and the list endpoint stays closed to them entirely.
        $this->actingAs($technician)->getJson('/api/v1/admin/users')->assertForbidden();

        // The administrator does see it.
        $admin = $this->admin();
        $own = $this->actingAs($admin)->getJson('/api/v1/user')->assertOk();

        $this->assertContains($own->json('data.presence'), ['online', 'offline']);
    }

    public function test_the_heartbeat_stamps_the_account_and_stays_lightweight(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'last_seen_at' => null]);

        $response = $this->actingAs($admin)->postJson('/api/v1/presence/ping')->assertOk();

        $this->assertSame('online', $response->json('data.presence'));
        $this->assertNotNull($admin->fresh()->last_seen_at);
    }
}
