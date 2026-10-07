<?php

namespace Tests\Feature;

use App\Models\SyncConflict;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Offline sync conflicts — the audit half of the offline-first system.
 *
 * The client detects a conflict and reports the resolution; the API only
 * records it. These tests pin the contract the queue depends on: the row is
 * always stamped with the caller, the vocabulary is closed, and the audit view
 * stays admin-only.
 */
class SyncConflictTest extends TestCase
{
    use RefreshDatabase;

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'entity_type' => 'field_visit',
            'entity_id' => 42,
            'kind' => 'field-visit',
            'queued_at' => now()->subHour()->toIso8601String(),
            'server_updated_at' => now()->toIso8601String(),
            'resolution' => 'overwrite',
            'summary' => 'Offline edit overwrote a newer server change.',
        ], $overrides);
    }

    public function test_a_technician_logs_a_conflict_and_it_is_stored(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($technician)
            ->postJson('/api/v1/sync/conflicts', $this->payload())
            ->assertCreated()
            ->assertJsonPath('data.entity_type', 'field_visit')
            ->assertJsonPath('data.entity_id', 42)
            ->assertJsonPath('data.resolution', 'overwrite');

        $this->assertDatabaseHas('sync_conflicts', [
            'user_id' => $technician->id,
            'entity_type' => 'field_visit',
            'entity_id' => 42,
            'resolution' => 'overwrite',
        ]);
    }

    public function test_the_row_is_always_stamped_with_the_caller(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $other = User::factory()->create(['role' => 'technician']);

        // A client cannot attribute a conflict to someone else.
        $this->actingAs($technician)
            ->postJson('/api/v1/sync/conflicts', $this->payload(['user_id' => $other->id]))
            ->assertCreated();

        $this->assertDatabaseHas('sync_conflicts', ['user_id' => $technician->id]);
        $this->assertDatabaseMissing('sync_conflicts', ['user_id' => $other->id]);
    }

    public function test_keeping_the_server_version_is_a_valid_resolution(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($technician)
            ->postJson('/api/v1/sync/conflicts', $this->payload([
                'resolution' => 'keep_server',
                'server_updated_at' => null,
            ]))
            ->assertCreated();

        $this->assertDatabaseHas('sync_conflicts', ['resolution' => SyncConflict::RESOLUTION_KEEP_SERVER]);
    }

    public function test_an_unknown_entity_type_is_rejected(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'technician']))
            ->postJson('/api/v1/sync/conflicts', $this->payload(['entity_type' => 'monitoring_record']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['entity_type']);
    }

    public function test_an_unknown_resolution_is_rejected(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'technician']))
            ->postJson('/api/v1/sync/conflicts', $this->payload(['resolution' => 'merge']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['resolution']);
    }

    public function test_guests_are_rejected(): void
    {
        $this->postJson('/api/v1/sync/conflicts', $this->payload())->assertUnauthorized();
    }

    public function test_the_audit_list_is_admin_only(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        SyncConflict::create([
            'user_id' => $admin->id,
            'entity_type' => 'case_note',
            'entity_id' => 7,
            'kind' => 'case-note',
            'queued_at' => now()->subHour(),
            'server_updated_at' => now(),
            'resolution' => 'overwrite',
        ]);

        foreach (['doctor', 'technician', 'farmer'] as $role) {
            $this->actingAs(User::factory()->create(['role' => $role]))
                ->getJson('/api/v1/admin/sync-conflicts')
                ->assertForbidden();
        }

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/sync-conflicts')
            ->assertOk()
            ->assertJsonPath('data.0.entity_type', 'case_note');
    }
}
