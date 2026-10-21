<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The admin add-beneficiary → monitoring-record pipeline: when an
 * administrator enrols a household on the Beneficiaries screen, a monitoring
 * record is created in the same transaction so the household lands on the
 * Monitoring table immediately. There is no New/Old accept lifecycle — the
 * admin entering the data is the trust assertion.
 */
class RegistrationMonitoringTest extends TestCase
{
    use RefreshDatabase;

    private function payload(array $overrides = []): array
    {
        return [
            'name_of_farmer' => 'Kylle Farmer',
            'address' => 'Ali-is',
            'animal_type' => 'Goat',
            'sex' => 'F',
            ...$overrides,
        ];
    }

    public function test_admin_adding_a_beneficiary_creates_a_monitoring_record_transactionally(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $response = $this->actingAs($admin)
            ->postJson('/api/v1/beneficiaries', $this->payload());

        $response->assertCreated();

        $beneficiary = Beneficiary::where('name_of_farmer', 'Kylle Farmer')->first();
        $this->assertNotNull($beneficiary);

        $record = MonitoringRecord::where('beneficiary_id', $beneficiary->id)->first();
        $this->assertNotNull($record, 'monitoring record must exist right after the beneficiary is added');

        // Admin-added records are trusted immediately: no pending state, no
        // status columns, no countdown.
        $this->assertNull($record->technician_id);
        $this->assertSame(1, MonitoringRecord::where('beneficiary_id', $beneficiary->id)->count());
    }

    public function test_a_technician_adding_a_beneficiary_owns_the_monitoring_record(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($technician)
            ->postJson('/api/v1/beneficiaries', $this->payload())
            ->assertCreated();

        $record = MonitoringRecord::latest('id')->first();
        $this->assertNotNull($record);
        $this->assertSame($technician->id, $record->technician_id);
    }

    public function test_a_failed_create_leaves_no_partial_rows(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        // Duplicate-free first call succeeds; the second is fine too — force a
        // failure with an invalid animal payload instead: an uncovered
        // barangay fails validation before anything is written.
        $this->actingAs($admin)
            ->postJson('/api/v1/beneficiaries', $this->payload())
            ->assertCreated();

        $beneficiariesBefore = Beneficiary::count();
        $recordsBefore = MonitoringRecord::count();

        $this->actingAs($admin)
            ->postJson('/api/v1/beneficiaries', $this->payload([
                'address' => 'Not A Barangay',
            ]))->assertUnprocessable();

        $this->assertSame($beneficiariesBefore, Beneficiary::count());
        $this->assertSame($recordsBefore, MonitoringRecord::count());
    }

    public function test_the_accept_workflow_is_gone(): void
    {
        // The New/Old registration lifecycle was removed along with
        // self-registration: the accept endpoint no longer exists at all.
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($admin)
            ->postJson('/api/v1/beneficiaries', $this->payload())
            ->assertCreated();

        $record = MonitoringRecord::latest('id')->first();

        $this->actingAs($admin)
            ->patchJson("/api/v1/monitoring-records/{$record->id}/accept")
            ->assertNotFound();

        $this->actingAs($technician)
            ->patchJson("/api/v1/monitoring-records/{$record->id}/accept")
            ->assertNotFound();
    }
}
