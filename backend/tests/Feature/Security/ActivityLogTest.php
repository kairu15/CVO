<?php

namespace Tests\Feature\Security;

use App\Models\ActivityLog;
use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Item 7 — audit / activity logs.
 *
 * The trail must capture logins, failed logins, lockouts, password resets,
 * CRUD on beneficiary/dispersal records and role changes. The read endpoint
 * is admin-only, and there is NO write path through the API.
 */
class ActivityLogTest extends TestCase
{
    use RefreshDatabase;

    public function test_logins_and_failed_logins_are_recorded(): void
    {
        $user = User::factory()->create();

        // Failure first...
        $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'wrong',
            'device_name' => 'phone',
        ])->assertUnprocessable();

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $user->id,
            'action' => 'failed_login',
        ]);

        // ...then the success.
        $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'password',
            'device_name' => 'phone',
        ])->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $user->id,
            'action' => 'login',
        ]);

        // And the mobile token issuance is on the trail too.
        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $user->id,
            'action' => 'token_issued',
        ]);
    }

    public function test_beneficiary_crud_is_recorded(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        // CREATE
        $beneficiary = Beneficiary::factory()->create();

        // UPDATE
        $this->actingAs($admin)
            ->patchJson("/api/v1/beneficiaries/{$beneficiary->id}", [
                'name_of_farmer' => 'Updated Name',
            ])->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $admin->id,
            'action' => 'beneficiary_updated',
            'target_type' => 'Beneficiary',
            'target_id' => $beneficiary->id,
        ]);

        // DELETE
        $this->actingAs($admin)
            ->deleteJson("/api/v1/beneficiaries/{$beneficiary->id}")
            ->assertNoContent();

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $admin->id,
            'action' => 'beneficiary_deleted',
            'target_id' => $beneficiary->id,
        ]);
    }

    public function test_dispersal_creation_is_recorded(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();

        $this->actingAs($technician)
            ->postJson('/api/v1/dispersal-events', [
                'beneficiary_id' => $beneficiary->id,
                'dispersal_type' => 'initial',
            ])->assertCreated();

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $technician->id,
            'action' => 'dispersal_created',
            'target_type' => 'DispersalEvent',
        ]);
    }

    public function test_role_changes_are_recorded_with_previous_and_new_role(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$farmer->id}/role", ['role' => 'doctor'])
            ->assertOk();

        $row = ActivityLog::query()
            ->where('actor_id', $admin->id)
            ->where('action', 'role_changed')
            ->where('target_id', $farmer->id)
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('farmer', $row->context['previous_role']);
        $this->assertSame('doctor', $row->context['new_role']);
    }

    public function test_rows_capture_the_request_context(): void
    {
        $user = User::factory()->create();

        $this->postJson('/api/v1/token-login', [
            'email' => $user->email,
            'password' => 'password',
            'device_name' => 'phone',
        ])->assertOk();

        $row = ActivityLog::query()->where('actor_id', $user->id)->where('action', 'login')->first();

        $this->assertNotNull($row->ip_address);
        $this->assertNotNull($row->actor_role);
        $this->assertSame('farmer', $row->actor_role);
    }

    public function test_the_log_endpoint_is_admin_only(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        foreach (['doctor', 'technician', 'farmer'] as $role) {
            $this->actingAs(User::factory()->create(['role' => $role]))
                ->getJson('/api/v1/admin/activity-logs')
                ->assertForbidden();
        }

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/activity-logs')
            ->assertOk();
    }

    public function test_the_log_endpoint_filters_by_action(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $user = User::factory()->create();

        $this->postJson('/api/v1/token-login', [
            'email' => $user->email, 'password' => 'password', 'device_name' => 'phone',
        ])->assertOk();

        $response = $this->actingAs($admin)
            ->getJson('/api/v1/admin/activity-logs?action=login')
            ->assertOk();

        foreach ($response->json('data') as $row) {
            $this->assertSame('login', $row['action']);
        }
    }

    public function test_the_log_has_no_write_path_through_the_api(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        // No create route exists; a POST to the collection must 405/404,
        // never 200.
        $this->actingAs($admin)
            ->postJson('/api/v1/admin/activity-logs', [
                'action' => 'login',
                'actor_id' => $admin->id,
            ])
            ->assertStatus(405);
    }
}
