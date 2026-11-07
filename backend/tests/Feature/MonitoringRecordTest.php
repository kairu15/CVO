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

    public function test_admin_has_oversight_and_can_edit_records_but_cannot_create_them(): void
    {
        $record = MonitoringRecord::factory()->by($this->technician)->for($this->beneficiary, 'beneficiary')->create();

        // Logging visits stays technician work — `monitoring.create` is not
        // granted to admins.
        $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->postJson('/api/v1/monitoring-records', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_monitored' => now()->toDateString(),
            ])
            ->assertForbidden();

        // Oversight: the admin may correct any monitoring row.
        $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->patchJson("/api/v1/monitoring-records/{$record->id}", [
                'remarks' => 'Flagged for checkup',
            ])
            ->assertOk()
            ->assertJsonPath('data.remarks', 'Flagged for checkup');
    }

    public function test_a_technician_can_edit_a_record_logged_by_a_colleague(): void
    {
        // The old doctor role's health oversight was merged into the
        // technician role, so a technician now corrects any monitoring row —
        // not only ones they logged themselves.
        $colleague = User::factory()->create(['role' => 'technician']);
        $record = MonitoringRecord::factory()->by($colleague)->for($this->beneficiary, 'beneficiary')->create();

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/monitoring-records/{$record->id}", [
                'remarks' => 'Corrected by oversight',
            ])
            ->assertOk()
            ->assertJsonPath('data.remarks', 'Corrected by oversight');
    }

    public function test_technician_sees_records_across_the_city(): void
    {
        // The technician absorbed the old doctor role's oversight, so the
        // list reaches every household — including one assigned to another
        // technician.
        $record = MonitoringRecord::factory()->by($this->technician)->for($this->beneficiary, 'beneficiary')->create();

        $otherTechnician = User::factory()->create(['role' => 'technician']);
        $otherBeneficiary = Beneficiary::factory()->assignedTo($otherTechnician)->create();
        $otherRecord = MonitoringRecord::factory()->by($otherTechnician)->for($otherBeneficiary, 'beneficiary')->create();

        $response = $this->actingAs($this->technician)->getJson('/api/v1/monitoring-records');

        $response->assertOk()->assertJsonCount(2, 'data');

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertEqualsCanonicalizing([$record->id, $otherRecord->id], $ids);
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
