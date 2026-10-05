<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\FieldVisit;
use App\Models\HealthRecord;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Bulk delete for the five list screens that offer it. Every endpoint must
 * authorize each row through the SAME policy as the single-row DELETE, report
 * missing/forbidden ids as failed_ids, and never let a partial batch abort.
 */
class BulkDeleteTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_bulk_deletes_monitoring_records(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $records = MonitoringRecord::factory()
            ->count(3)
            ->create(['registration_status' => MonitoringRecord::REGISTRATION_NONE]);

        $this->actingAs($admin)
            ->postJson('/api/v1/monitoring-records/bulk-delete', [
                'ids' => [$records[0]->id, $records[1]->id],
            ])
            ->assertOk()
            ->assertJsonPath('data.deleted', 2)
            ->assertJsonPath('data.failed_ids', []);

        $this->assertSoftDeleted('monitoring_records', ['id' => $records[0]->id]);
        $this->assertSoftDeleted('monitoring_records', ['id' => $records[1]->id]);
        $this->assertNotSoftDeleted('monitoring_records', ['id' => $records[2]->id]);
    }

    public function test_technician_can_bulk_delete_their_own_monitoring_records(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $records = MonitoringRecord::factory()
            ->count(2)
            ->create([
                'technician_id' => $technician->id,
                'registration_status' => MonitoringRecord::REGISTRATION_NONE,
            ]);

        $this->actingAs($technician)
            ->postJson('/api/v1/monitoring-records/bulk-delete', [
                'ids' => $records->pluck('id'),
            ])
            ->assertOk()
            ->assertJsonPath('data.deleted', 2);
    }

    public function test_a_technician_cannot_bulk_delete_someone_elses_records(): void
    {
        $owner = User::factory()->create(['role' => 'technician']);
        $other = User::factory()->create(['role' => 'technician']);
        $record = MonitoringRecord::factory()->create([
            'technician_id' => $owner->id,
            'registration_status' => MonitoringRecord::REGISTRATION_NONE,
        ]);

        $this->actingAs($other)
            ->postJson('/api/v1/monitoring-records/bulk-delete', [
                'ids' => [$record->id],
            ])
            ->assertOk()
            ->assertJsonPath('data.deleted', 0)
            ->assertJsonPath('data.failed_ids', [$record->id]);

        $this->assertNotSoftDeleted('monitoring_records', ['id' => $record->id]);
    }

    public function test_missing_ids_are_reported_as_failed_not_a_422(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $record = MonitoringRecord::factory()->create([
            'registration_status' => MonitoringRecord::REGISTRATION_NONE,
        ]);

        $this->actingAs($admin)
            ->postJson('/api/v1/monitoring-records/bulk-delete', [
                'ids' => [$record->id, 999999],
            ])
            ->assertOk()
            ->assertJsonPath('data.deleted', 1)
            ->assertJsonPath('data.failed_ids', [999999]);
    }

    public function test_admin_bulk_deletes_case_notes_and_health_records(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $note = CaseNote::factory()->create();
        $health = HealthRecord::factory()->create();

        $this->actingAs($admin)
            ->postJson('/api/v1/case-notes/bulk-delete', ['ids' => [$note->id]])
            ->assertOk()
            ->assertJsonPath('data.deleted', 1);

        $this->actingAs($admin)
            ->postJson('/api/v1/health-records/bulk-delete', ['ids' => [$health->id]])
            ->assertOk()
            ->assertJsonPath('data.deleted', 1);

        $this->assertSoftDeleted('case_notes', ['id' => $note->id]);
        $this->assertSoftDeleted('health_records', ['id' => $health->id]);
    }

    public function test_a_technician_bulk_deletes_their_own_field_visits(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $visits = FieldVisit::factory()->count(2)->create(['technician_id' => $technician->id]);

        $this->actingAs($technician)
            ->postJson('/api/v1/field-visits/bulk-delete', ['ids' => $visits->pluck('id')])
            ->assertOk()
            ->assertJsonPath('data.deleted', 2);

        foreach ($visits as $visit) {
            $this->assertSoftDeleted('field_visits', ['id' => $visit->id]);
        }
    }

    public function test_admin_bulk_deletes_beneficiaries_but_others_cannot(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiaries = Beneficiary::factory()->count(2)->create();

        // A non-admin gets nothing deleted; the rows come back as failed.
        $this->actingAs($technician)
            ->postJson('/api/v1/beneficiaries/bulk-delete', [
                'ids' => $beneficiaries->pluck('id'),
            ])
            ->assertOk()
            ->assertJsonPath('data.deleted', 0);

        $this->assertNotSoftDeleted('beneficiaries', ['id' => $beneficiaries[0]->id]);

        $this->actingAs($admin)
            ->postJson('/api/v1/beneficiaries/bulk-delete', [
                'ids' => $beneficiaries->pluck('id'),
            ])
            ->assertOk()
            ->assertJsonPath('data.deleted', 2);

        $this->assertSoftDeleted('beneficiaries', ['id' => $beneficiaries[0]->id]);
        $this->assertSoftDeleted('beneficiaries', ['id' => $beneficiaries[1]->id]);
    }

    public function test_bulk_delete_requires_at_least_one_id(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->postJson('/api/v1/monitoring-records/bulk-delete', ['ids' => []])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['ids']);
    }
}
