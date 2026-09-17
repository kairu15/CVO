<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MonitoringRecordTest extends TestCase
{
    use RefreshDatabase;

    private User $technician;

    private Beneficiary $beneficiary;

    protected function setUp(): void
    {
        parent::setUp();

        $this->technician = User::factory()->create(['role' => 'technician']);
        $this->beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create();
    }

    public function test_technician_can_log_a_visit_for_an_assigned_beneficiary(): void
    {
        $response = $this->actingAs($this->technician)->postJson('/api/v1/monitoring-records', [
            'beneficiary_id' => $this->beneficiary->id,
            'date_monitored' => now()->toDateString(),
            'date_vits_supp' => now()->toDateString(),
            'deworming_date' => now()->toDateString(),
            'bcs' => 4,
            'remarks' => 'Healthy',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.name_of_farmer', $this->beneficiary->name_of_farmer)
            ->assertJsonPath('data.address', $this->beneficiary->address)
            ->assertJsonPath('data.animal_type', $this->beneficiary->animal_type)
            ->assertJsonPath('data.sex', $this->beneficiary->sex)
            ->assertJsonPath('data.bcs', 4);

        $this->assertDatabaseHas('monitoring_records', [
            'beneficiary_id' => $this->beneficiary->id,
            'technician_id' => $this->technician->id,
            'bcs' => 4,
        ]);
    }

    public function test_technician_cannot_log_a_visit_for_an_unassigned_beneficiary(): void
    {
        $other = Beneficiary::factory()->create(); // no technician

        $response = $this->actingAs($this->technician)->postJson('/api/v1/monitoring-records', [
            'beneficiary_id' => $other->id,
            'date_monitored' => now()->toDateString(),
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['beneficiary_id']);
    }

    public function test_identity_fields_cannot_be_overridden_by_the_client(): void
    {
        // Even if a payload tries to sneak in identity fields, they are
        // ignored: identity comes from the beneficiary record only.
        $response = $this->actingAs($this->technician)->postJson('/api/v1/monitoring-records', [
            'beneficiary_id' => $this->beneficiary->id,
            'date_monitored' => now()->toDateString(),
            'name_of_farmer' => 'Hacked Name',
            'address' => 'Nowhere',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.name_of_farmer', $this->beneficiary->name_of_farmer)
            ->assertJsonPath('data.address', $this->beneficiary->address);
    }

    public function test_doctors_cannot_create_records_but_can_edit_them(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor']);
        $record = MonitoringRecord::factory()->by($this->technician)->for($this->beneficiary, 'beneficiary')->create();

        $this->actingAs($doctor)
            ->postJson('/api/v1/monitoring-records', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_monitored' => now()->toDateString(),
            ])
            ->assertForbidden();

        $this->actingAs($doctor)
            ->patchJson("/api/v1/monitoring-records/{$record->id}", [
                'remarks' => 'Flagged for checkup',
            ])
            ->assertOk()
            ->assertJsonPath('data.remarks', 'Flagged for checkup');
    }

    public function test_farmer_sees_only_own_records_and_cannot_edit(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $own = Beneficiary::factory()->forFarmer($farmer)->create();
        $record = MonitoringRecord::factory()->by($this->technician)->for($own, 'beneficiary')->create();

        MonitoringRecord::factory()->count(3)->for($this->beneficiary, 'beneficiary')->create();

        $this->actingAs($farmer)
            ->getJson('/api/v1/monitoring-records')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->actingAs($farmer)
            ->patchJson("/api/v1/monitoring-records/{$record->id}", ['remarks' => 'self-edit'])
            ->assertForbidden();
    }

    public function test_technician_sees_only_records_of_assigned_beneficiaries(): void
    {
        $record = MonitoringRecord::factory()->by($this->technician)->for($this->beneficiary, 'beneficiary')->create();

        $otherTechnician = User::factory()->create(['role' => 'technician']);
        $otherBeneficiary = Beneficiary::factory()->assignedTo($otherTechnician)->create();
        MonitoringRecord::factory()->by($otherTechnician)->for($otherBeneficiary, 'beneficiary')->create();

        $response = $this->actingAs($this->technician)->getJson('/api/v1/monitoring-records');

        $response->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_create_validates_bcs_range(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/monitoring-records', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_monitored' => now()->toDateString(),
                'bcs' => 9,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['bcs']);
    }
}
