<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The MOA status toggle on the monitoring table.
 *
 * MOA is an agreement PER DISPERSAL, stored on the beneficiary (animal +
 * household) row rather than per visit. Flipping it is an admin-oversight
 * action gated on the `monitoring.set-moa` capability (seeded admin-only) —
 * doctors and technicians keep their existing edit rights on the row but
 * cannot sign off on the program agreement.
 */
class MonitoringMoaTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $technician;

    private Beneficiary $beneficiary;

    private MonitoringRecord $record;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
        $this->technician = User::factory()->create(['role' => 'technician']);
        $this->beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create();
        $this->record = MonitoringRecord::factory()
            ->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create();
    }

    public function test_admin_can_mark_moa_signed_and_it_is_returned(): void
    {
        $this->actingAs($this->admin)
            ->patchJson("/api/v1/monitoring-records/{$this->record->id}/moa", ['moa_signed' => true])
            ->assertOk()
            ->assertJsonPath('data.moa_signed', true);

        $this->assertDatabaseHas('beneficiaries', [
            'id' => $this->beneficiary->id,
            'moa_signed' => true,
        ]);
        $this->assertDatabaseHas('activity_logs', ['action' => 'monitoring_moa_updated']);
    }

    public function test_admin_can_flip_moa_back_to_not_signed(): void
    {
        $this->beneficiary->update(['moa_signed' => true]);

        $this->actingAs($this->admin)
            ->patchJson("/api/v1/monitoring-records/{$this->record->id}/moa", ['moa_signed' => false])
            ->assertOk()
            ->assertJsonPath('data.moa_signed', false);

        $this->assertDatabaseHas('beneficiaries', [
            'id' => $this->beneficiary->id,
            'moa_signed' => false,
        ]);
    }

    public function test_moa_is_per_dispersal_so_sibling_visits_share_it(): void
    {
        MonitoringRecord::factory()
            ->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create();

        $this->actingAs($this->admin)
            ->patchJson("/api/v1/monitoring-records/{$this->record->id}/moa", ['moa_signed' => true])
            ->assertOk();

        // The flag lives on the beneficiary, so every visit row for the
        // household reports it — not just the row that was clicked.
        $rows = $this->actingAs($this->admin)
            ->getJson('/api/v1/monitoring-records')
            ->assertOk()
            ->json('data');

        $this->assertCount(2, $rows);
        foreach ($rows as $row) {
            $this->assertTrue($row['moa_signed']);
        }
    }

    public function test_doctor_technician_and_farmer_cannot_set_moa(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor']);
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($doctor)
            ->patchJson("/api/v1/monitoring-records/{$this->record->id}/moa", ['moa_signed' => true])
            ->assertForbidden();

        // Even the technician who logged the visit cannot flip the agreement.
        $this->actingAs($this->technician)
            ->patchJson("/api/v1/monitoring-records/{$this->record->id}/moa", ['moa_signed' => true])
            ->assertForbidden();

        $this->actingAs($farmer)
            ->patchJson("/api/v1/monitoring-records/{$this->record->id}/moa", ['moa_signed' => true])
            ->assertForbidden();

        $this->assertDatabaseHas('beneficiaries', [
            'id' => $this->beneficiary->id,
            'moa_signed' => null,
        ]);
    }

    public function test_a_guest_cannot_set_moa(): void
    {
        $this->patchJson("/api/v1/monitoring-records/{$this->record->id}/moa", ['moa_signed' => true])
            ->assertUnauthorized();
    }

    public function test_moa_requires_a_boolean(): void
    {
        $this->actingAs($this->admin)
            ->patchJson("/api/v1/monitoring-records/{$this->record->id}/moa", [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['moa_signed']);

        $this->actingAs($this->admin)
            ->patchJson("/api/v1/monitoring-records/{$this->record->id}/moa", ['moa_signed' => 'maybe'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['moa_signed']);
    }

    public function test_monitoring_resource_exposes_rsbsa_moa_and_ear_tag(): void
    {
        $this->beneficiary->update([
            'rsbsa_number' => '12-34-56-789-000012',
            'moa_signed' => true,
            'ear_tag_number' => 'ET-0001',
        ]);

        $this->actingAs($this->admin)
            ->getJson("/api/v1/monitoring-records/{$this->record->id}")
            ->assertOk()
            ->assertJsonPath('data.rsbsa_number', '12-34-56-789-000012')
            ->assertJsonPath('data.moa_signed', true)
            ->assertJsonPath('data.ear_tag_number', 'ET-0001');
    }

    public function test_technician_scoping_is_unchanged_by_the_new_fields(): void
    {
        // A technician must not see another technician's household merely
        // because the registry fields were added.
        $otherTechnician = User::factory()->create(['role' => 'technician']);
        $otherBeneficiary = Beneficiary::factory()
            ->assignedTo($otherTechnician)
            ->create(['rsbsa_number' => '99-99-99-999-999999']);

        MonitoringRecord::factory()
            ->by($otherTechnician)
            ->for($otherBeneficiary, 'beneficiary')
            ->create();

        MonitoringRecord::factory()
            ->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create();

        $rows = $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records')
            ->assertOk()
            ->json('data');

        $this->assertCount(2, $rows); // only the two rows of their own household
        foreach ($rows as $row) {
            $this->assertSame($this->beneficiary->id, $row['beneficiary_id']);
        }
    }
}
