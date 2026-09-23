<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CaseNoteTest extends TestCase
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

    public function test_doctor_can_write_a_case_note(): void
    {
        $response = $this->actingAs($this->doctor)->postJson('/api/v1/case-notes', [
            'beneficiary_id' => $this->beneficiary->id,
            'date_noted' => now()->toDateString(),
            'body' => 'Owner phoned — animal still limping, advised rest for a week.',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.body', 'Owner phoned — animal still limping, advised rest for a week.')
            ->assertJsonPath('data.name_of_farmer', $this->beneficiary->name_of_farmer)
            ->assertJsonPath('data.animal_type', $this->beneficiary->animal_type)
            ->assertJsonPath('data.doctor_id', $this->doctor->id);

        $this->assertDatabaseHas('case_notes', [
            'beneficiary_id' => $this->beneficiary->id,
            'doctor_id' => $this->doctor->id,
        ]);
    }

    public function test_a_note_needs_no_diagnosis_which_is_what_separates_it_from_a_health_record(): void
    {
        // The whole point of this table: an observation worth recording that is
        // not a clinical diagnosis. Health records would reject this payload.
        $this->actingAs($this->doctor)
            ->postJson('/api/v1/case-notes', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_noted' => now()->toDateString(),
                'body' => 'Advised the owner to isolate the rest of the herd.',
            ])
            ->assertCreated();

        $this->actingAs($this->doctor)
            ->postJson('/api/v1/health-records', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_recorded' => now()->toDateString(),
                'body' => 'Advised the owner to isolate the rest of the herd.',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['diagnosis']);
    }

    public function test_the_author_is_taken_from_the_session_not_the_payload(): void
    {
        $otherDoctor = User::factory()->create(['role' => 'doctor']);

        $this->actingAs($this->doctor)
            ->postJson('/api/v1/case-notes', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_noted' => now()->toDateString(),
                'body' => 'Referred to the provincial vet.',
                'doctor_id' => $otherDoctor->id,
            ])
            ->assertCreated()
            ->assertJsonPath('data.doctor_id', $this->doctor->id);
    }

    public function test_only_veterinarians_can_write_notes(): void
    {
        $payload = [
            'beneficiary_id' => $this->beneficiary->id,
            'date_noted' => now()->toDateString(),
            'body' => 'Should not be allowed.',
        ];

        foreach (['technician', 'farmer', 'admin'] as $role) {
            $user = $role === 'technician'
                ? $this->technician
                : User::factory()->create(['role' => $role]);

            $this->actingAs($user)
                ->postJson('/api/v1/case-notes', $payload)
                ->assertForbidden();
        }
    }

    public function test_create_requires_a_body_and_rejects_a_future_date(): void
    {
        $this->actingAs($this->doctor)
            ->postJson('/api/v1/case-notes', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_noted' => now()->addWeek()->toDateString(),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['body', 'date_noted']);
    }

    public function test_an_unknown_beneficiary_is_rejected(): void
    {
        $this->actingAs($this->doctor)
            ->postJson('/api/v1/case-notes', [
                'beneficiary_id' => 99999,
                'date_noted' => now()->toDateString(),
                'body' => 'Nowhere.',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['beneficiary_id']);
    }

    public function test_the_author_can_revise_their_own_note_but_not_a_colleagues(): void
    {
        $note = CaseNote::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->doctor)
            ->patchJson("/api/v1/case-notes/{$note->id}", ['body' => 'Corrected observation.'])
            ->assertOk()
            ->assertJsonPath('data.body', 'Corrected observation.');

        $colleague = User::factory()->create(['role' => 'doctor']);

        $this->actingAs($colleague)
            ->patchJson("/api/v1/case-notes/{$note->id}", ['body' => 'Rewriting a colleague.'])
            ->assertForbidden();
    }

    public function test_an_admin_can_correct_a_note_after_the_vet_leaves(): void
    {
        $note = CaseNote::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/case-notes/{$note->id}", ['body' => 'Admin correction.'])
            ->assertOk()
            ->assertJsonPath('data.body', 'Admin correction.');
    }

    public function test_a_note_cannot_be_moved_to_another_animal(): void
    {
        $note = CaseNote::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();
        $other = Beneficiary::factory()->create();

        $this->actingAs($this->doctor)
            ->patchJson("/api/v1/case-notes/{$note->id}", [
                'beneficiary_id' => $other->id,
                'body' => 'Moved?',
            ])
            ->assertOk();

        $this->assertDatabaseHas('case_notes', [
            'id' => $note->id,
            'beneficiary_id' => $this->beneficiary->id,
        ]);
    }

    public function test_the_author_can_delete_their_own_note(): void
    {
        $note = CaseNote::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->doctor)
            ->deleteJson("/api/v1/case-notes/{$note->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('case_notes', ['id' => $note->id]);
    }

    public function test_a_farmer_sees_only_notes_for_their_own_animals(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $own = Beneficiary::factory()->forFarmer($farmer)->create();
        CaseNote::factory()->by($this->doctor)->forBeneficiary($own)->create();

        CaseNote::factory()->count(3)
            ->by($this->doctor)
            ->forBeneficiary($this->beneficiary)
            ->create();

        $this->actingAs($farmer)
            ->getJson('/api/v1/case-notes')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.beneficiary_id', $own->id);
    }

    public function test_a_technician_sees_only_notes_for_assigned_beneficiaries(): void
    {
        CaseNote::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();

        $otherTechnician = User::factory()->create(['role' => 'technician']);
        $other = Beneficiary::factory()->assignedTo($otherTechnician)->create();
        CaseNote::factory()->by($this->doctor)->forBeneficiary($other)->create();

        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_a_farmer_cannot_read_another_farmers_note_by_id(): void
    {
        $note = CaseNote::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)->create();
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($farmer)
            ->getJson("/api/v1/case-notes/{$note->id}")
            ->assertNotFound();
    }

    public function test_notes_are_returned_newest_first(): void
    {
        $old = CaseNote::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)
            ->create(['date_noted' => now()->subMonth()->toDateString()]);
        $new = CaseNote::factory()->by($this->doctor)->forBeneficiary($this->beneficiary)
            ->create(['date_noted' => now()->toDateString()]);

        $this->actingAs($this->doctor)
            ->getJson('/api/v1/case-notes')
            ->assertOk()
            ->assertJsonPath('data.0.id', $new->id)
            ->assertJsonPath('data.1.id', $old->id);
    }

    public function test_guests_are_rejected(): void
    {
        $this->getJson('/api/v1/case-notes')->assertUnauthorized();
    }
}
