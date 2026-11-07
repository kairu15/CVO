<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\HealthRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HealthRecordTest extends TestCase
{
    use RefreshDatabase;

    private User $technician;

    private User $admin;

    private Beneficiary $beneficiary;

    protected function setUp(): void
    {
        parent::setUp();

        $this->technician = User::factory()->create(['role' => 'technician']);
        $this->admin = User::factory()->create(['role' => 'admin']);
        $this->beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create();
    }

    public function test_a_technician_can_author_a_health_record(): void
    {
        $response = $this->actingAs($this->technician)->postJson('/api/v1/health-records', [
            'beneficiary_id' => $this->beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Foot and mouth disease (suspected)',
            'treatment' => 'Isolate and start supportive therapy',
            'outcome' => 'ongoing',
            'remarks' => 'Recheck in 7 days',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.diagnosis', 'Foot and mouth disease (suspected)')
            ->assertJsonPath('data.outcome', 'ongoing')
            // Identity and author always come from the server, never the payload.
            ->assertJsonPath('data.name_of_farmer', $this->beneficiary->name_of_farmer)
            ->assertJsonPath('data.address', $this->beneficiary->address)
            ->assertJsonPath('data.animal_type', $this->beneficiary->animal_type)
            // doctor_id is the attending veterinarian — the authoring technician.
            ->assertJsonPath('data.doctor_id', $this->technician->id);

        $this->assertDatabaseHas('health_records', [
            'beneficiary_id' => $this->beneficiary->id,
            'doctor_id' => $this->technician->id,
            'outcome' => 'ongoing',
        ]);
    }

    public function test_the_author_is_taken_from_the_session_not_the_payload(): void
    {
        $otherTechnician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($this->technician)->postJson('/api/v1/health-records', [
            'beneficiary_id' => $this->beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Internal parasites',
            'doctor_id' => $otherTechnician->id,
        ])->assertCreated()->assertJsonPath('data.doctor_id', $this->technician->id);
    }

    public function test_only_capability_holders_can_author_records(): void
    {
        $payload = [
            'beneficiary_id' => $this->beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Mastitis',
        ];

        // The technician holds the seeded clinical authoring grant...
        $this->actingAs($this->technician)
            ->postJson('/api/v1/health-records', $payload)
            ->assertCreated();

        // ...the administrator does not: writing a clinical diagnosis is not
        // program oversight, and there is no other staff role to fall back on.
        $this->actingAs($this->admin)
            ->postJson('/api/v1/health-records', $payload)
            ->assertForbidden();
    }

    public function test_create_requires_a_diagnosis_and_a_valid_outcome(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/health-records', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_recorded' => now()->toDateString(),
                'outcome' => 'miraculous',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['diagnosis', 'outcome']);
    }

    public function test_the_outcome_vocabulary_follows_the_saved_settings(): void
    {
        // An admin retires the shipped list and saves a new one.
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/settings', [
                'health_outcomes' => ['recovered', 'under treatment'],
            ])
            ->assertOk();

        // The newly added outcome is accepted...
        $this->actingAs($this->technician)->postJson('/api/v1/health-records', [
            'beneficiary_id' => $this->beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Brucellosis',
            'outcome' => 'under treatment',
        ])->assertCreated()->assertJsonPath('data.outcome', 'under treatment');

        // ...and one the vocabulary no longer contains is refused.
        $this->actingAs($this->technician)->postJson('/api/v1/health-records', [
            'beneficiary_id' => $this->beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Brucellosis',
            'outcome' => 'deceased',
        ])->assertUnprocessable()->assertJsonValidationErrors(['outcome']);
    }

    public function test_an_unknown_beneficiary_is_rejected(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/health-records', [
                'beneficiary_id' => 99999,
                'date_recorded' => now()->toDateString(),
                'diagnosis' => 'Mastitis',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['beneficiary_id']);
    }

    public function test_a_future_date_is_rejected(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/health-records', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_recorded' => now()->addWeek()->toDateString(),
                'diagnosis' => 'Mastitis',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['date_recorded']);
    }

    public function test_the_author_can_revise_their_own_record_but_not_a_colleagues(): void
    {
        $record = HealthRecord::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/health-records/{$record->id}", ['outcome' => 'recovered'])
            ->assertOk()
            ->assertJsonPath('data.outcome', 'recovered');

        // A DIFFERENT technician cannot rewrite a colleague's clinical judgement.
        $colleague = User::factory()->create(['role' => 'technician']);

        $this->actingAs($colleague)
            ->patchJson("/api/v1/health-records/{$record->id}", ['outcome' => 'deceased'])
            ->assertForbidden();
    }

    public function test_an_admin_can_correct_a_record_after_the_technician_leaves(): void
    {
        $record = HealthRecord::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->admin)
            ->patchJson("/api/v1/health-records/{$record->id}", ['outcome' => 'referred'])
            ->assertOk()
            ->assertJsonPath('data.outcome', 'referred');
    }

    public function test_a_record_cannot_be_moved_to_another_animal(): void
    {
        $record = HealthRecord::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();
        $other = Beneficiary::factory()->create();

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/health-records/{$record->id}", [
                'beneficiary_id' => $other->id,
                'diagnosis' => 'Mastitis',
            ])
            ->assertOk();

        // beneficiary_id is not accepted, so the record stays with its animal.
        $this->assertDatabaseHas('health_records', [
            'id' => $record->id,
            'beneficiary_id' => $this->beneficiary->id,
        ]);
    }

    public function test_the_author_can_delete_their_own_record(): void
    {
        $record = HealthRecord::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->technician)
            ->deleteJson("/api/v1/health-records/{$record->id}")
            ->assertNoContent();

        $this->assertSoftDeleted('health_records', ['id' => $record->id]);
    }

    public function test_a_technician_sees_records_city_wide(): void
    {
        HealthRecord::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        // Another technician's assignment AND another technician's authorship —
        // both still visible: the technician absorbed the old doctor role's
        // city-wide clinical oversight, so there is no assigned-only slice.
        $otherTechnician = User::factory()->create(['role' => 'technician']);
        $other = Beneficiary::factory()->assignedTo($otherTechnician)->create();
        HealthRecord::factory()->forBeneficiary($other)->create();

        $this->actingAs($this->technician)
            ->getJson('/api/v1/health-records')
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_a_technician_can_read_a_record_on_any_beneficiary_by_id(): void
    {
        $unassigned = Beneficiary::factory()->create(); // nobody's assignment
        $record = HealthRecord::factory()->by($this->technician)->forBeneficiary($unassigned)->create();

        // City-wide read scope: an unassigned household is no longer invisible.
        $this->actingAs($this->technician)
            ->getJson("/api/v1/health-records/{$record->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $record->id);
    }

    public function test_guests_are_rejected(): void
    {
        $this->getJson('/api/v1/health-records')->assertUnauthorized();
    }

    public function test_the_outcome_vocabulary_is_served_to_the_form(): void
    {
        $response = $this->actingAs($this->technician)
            ->getJson('/api/v1/health-records/options');

        // Must not be mistaken for a record id by the apiResource route.
        $response->assertOk()
            ->assertJsonPath('data.outcomes', config('cvo.health_outcomes'));
    }
}
