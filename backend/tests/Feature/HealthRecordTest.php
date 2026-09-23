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

    private User $doctor;

    private User $technician;

    private Beneficiary $beneficiary;

    protected function setUp(): void
    {
        parent::setUp();

        $this->doctor = User::factory()->create(['role' => 'doctor']);
        $this->technician = User::factory()->create(['role' => 'technician']);
        $this->beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create();
    }

    public function test_doctor_can_author_a_health_record(): void
    {
        $response = $this->actingAs($this->doctor)->postJson('/api/v1/health-records', [
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
            ->assertJsonPath('data.doctor_id', $this->doctor->id);

        $this->assertDatabaseHas('health_records', [
            'beneficiary_id' => $this->beneficiary->id,
            'doctor_id' => $this->doctor->id,
            'outcome' => 'ongoing',
        ]);
    }

    public function test_the_author_is_taken_from_the_session_not_the_payload(): void
    {
        $otherDoctor = User::factory()->create(['role' => 'doctor']);

        $this->actingAs($this->doctor)->postJson('/api/v1/health-records', [
            'beneficiary_id' => $this->beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Internal parasites',
            'doctor_id' => $otherDoctor->id,
        ])->assertCreated()->assertJsonPath('data.doctor_id', $this->doctor->id);
    }

    public function test_only_veterinarians_can_author_records(): void
    {
        $payload = [
            'beneficiary_id' => $this->beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Mastitis',
        ];

        foreach (['technician', 'farmer', 'admin'] as $role) {
            $user = $role === 'technician'
                ? $this->technician
                : User::factory()->create(['role' => $role]);

            $this->actingAs($user)
                ->postJson('/api/v1/health-records', $payload)
                ->assertForbidden();
        }
    }

    public function test_create_requires_a_diagnosis_and_a_valid_outcome(): void
    {
        $this->actingAs($this->doctor)
            ->postJson('/api/v1/health-records', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_recorded' => now()->toDateString(),
                'outcome' => 'miraculous',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['diagnosis', 'outcome']);
    }

    public function test_an_unknown_beneficiary_is_rejected(): void
    {
        $this->actingAs($this->doctor)
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
        $this->actingAs($this->doctor)
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
        $record = HealthRecord::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->doctor)
            ->patchJson("/api/v1/health-records/{$record->id}", ['outcome' => 'recovered'])
            ->assertOk()
            ->assertJsonPath('data.outcome', 'recovered');

        $colleague = User::factory()->create(['role' => 'doctor']);

        $this->actingAs($colleague)
            ->patchJson("/api/v1/health-records/{$record->id}", ['outcome' => 'deceased'])
            ->assertForbidden();
    }

    public function test_an_admin_can_correct_a_record_after_the_vet_leaves(): void
    {
        $record = HealthRecord::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/health-records/{$record->id}", ['outcome' => 'referred'])
            ->assertOk()
            ->assertJsonPath('data.outcome', 'referred');
    }

    public function test_a_record_cannot_be_moved_to_another_animal(): void
    {
        $record = HealthRecord::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();
        $other = Beneficiary::factory()->create();

        $this->actingAs($this->doctor)
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
        $record = HealthRecord::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->doctor)
            ->deleteJson("/api/v1/health-records/{$record->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('health_records', ['id' => $record->id]);
    }

    public function test_a_farmer_sees_only_records_for_their_own_animals(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $own = Beneficiary::factory()->forFarmer($farmer)->create();
        HealthRecord::factory()->by($this->doctor)->forBeneficiary($own)->create();

        HealthRecord::factory()->count(3)
            ->by($this->doctor)
            ->forBeneficiary($this->beneficiary)
            ->create();

        $this->actingAs($farmer)
            ->getJson('/api/v1/health-records')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->actingAs($farmer)
            ->getJson('/api/v1/health-records')
            ->assertJsonPath('data.0.beneficiary_id', $own->id);
    }

    public function test_a_technician_sees_only_records_for_assigned_beneficiaries(): void
    {
        HealthRecord::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();

        $otherTechnician = User::factory()->create(['role' => 'technician']);
        $other = Beneficiary::factory()->assignedTo($otherTechnician)->create();
        HealthRecord::factory()->by($this->doctor)->forBeneficiary($other)->create();

        $this->actingAs($this->technician)
            ->getJson('/api/v1/health-records')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_a_farmer_cannot_read_another_farmers_record_by_id(): void
    {
        $record = HealthRecord::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();
        $farmer = User::factory()->create(['role' => 'farmer']);

        // Out of scope, so it must not even confirm the record exists.
        $this->actingAs($farmer)
            ->getJson("/api/v1/health-records/{$record->id}")
            ->assertNotFound();
    }

    public function test_guests_are_rejected(): void
    {
        $this->getJson('/api/v1/health-records')->assertUnauthorized();
    }

    public function test_the_outcome_vocabulary_is_served_to_the_form(): void
    {
        $response = $this->actingAs($this->doctor)
            ->getJson('/api/v1/health-records/options');

        // Must not be mistaken for a record id by the apiResource route.
        $response->assertOk()
            ->assertJsonPath('data.outcomes', config('cvo.health_outcomes'));
    }
}
