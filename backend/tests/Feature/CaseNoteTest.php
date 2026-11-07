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

    public function test_a_technician_can_write_a_case_note(): void
    {
        $response = $this->actingAs($this->technician)->postJson('/api/v1/case-notes', [
            'beneficiary_id' => $this->beneficiary->id,
            'date_noted' => now()->toDateString(),
            'body' => 'Owner phoned — animal still limping, advised rest for a week.',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.body', 'Owner phoned — animal still limping, advised rest for a week.')
            ->assertJsonPath('data.name_of_farmer', $this->beneficiary->name_of_farmer)
            ->assertJsonPath('data.animal_type', $this->beneficiary->animal_type)
            // doctor_id is the attending veterinarian — the authoring technician.
            ->assertJsonPath('data.doctor_id', $this->technician->id);

        $this->assertDatabaseHas('case_notes', [
            'beneficiary_id' => $this->beneficiary->id,
            'doctor_id' => $this->technician->id,
        ]);
    }

    public function test_a_note_needs_no_diagnosis_which_is_what_separates_it_from_a_health_record(): void
    {
        // The whole point of this table: an observation worth recording that is
        // not a clinical diagnosis. Health records would reject this payload.
        $this->actingAs($this->technician)
            ->postJson('/api/v1/case-notes', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_noted' => now()->toDateString(),
                'body' => 'Advised the owner to isolate the rest of the herd.',
            ])
            ->assertCreated();

        $this->actingAs($this->technician)
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
        $otherTechnician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($this->technician)
            ->postJson('/api/v1/case-notes', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_noted' => now()->toDateString(),
                'body' => 'Referred to the provincial vet.',
                'doctor_id' => $otherTechnician->id,
            ])
            ->assertCreated()
            ->assertJsonPath('data.doctor_id', $this->technician->id);
    }

    public function test_only_capability_holders_can_write_notes(): void
    {
        $payload = [
            'beneficiary_id' => $this->beneficiary->id,
            'date_noted' => now()->toDateString(),
            'body' => 'Should not be allowed.',
        ];

        // The technician holds the seeded case-note authoring grant...
        $this->actingAs($this->technician)
            ->postJson('/api/v1/case-notes', $payload)
            ->assertCreated();

        // ...the administrator does not: an observation is field/clinical
        // work, not program oversight.
        $this->actingAs($this->admin)
            ->postJson('/api/v1/case-notes', $payload)
            ->assertForbidden();
    }

    public function test_create_requires_a_body_and_rejects_a_future_date(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/case-notes', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_noted' => now()->addWeek()->toDateString(),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['body', 'date_noted']);
    }

    public function test_an_unknown_beneficiary_is_rejected(): void
    {
        $this->actingAs($this->technician)
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
        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/case-notes/{$note->id}", ['body' => 'Corrected observation.'])
            ->assertOk()
            ->assertJsonPath('data.body', 'Corrected observation.');

        // A DIFFERENT technician cannot rewrite a colleague's observations —
        // an author is part of what a note means.
        $colleague = User::factory()->create(['role' => 'technician']);

        $this->actingAs($colleague)
            ->patchJson("/api/v1/case-notes/{$note->id}", ['body' => 'Rewriting a colleague.'])
            ->assertForbidden();
    }

    public function test_an_admin_can_correct_a_note_after_the_technician_leaves(): void
    {
        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->admin)
            ->patchJson("/api/v1/case-notes/{$note->id}", ['body' => 'Admin correction.'])
            ->assertOk()
            ->assertJsonPath('data.body', 'Admin correction.');
    }

    public function test_a_note_cannot_be_moved_to_another_animal(): void
    {
        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();
        $other = Beneficiary::factory()->create();

        $this->actingAs($this->technician)
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
        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->technician)
            ->deleteJson("/api/v1/case-notes/{$note->id}")
            ->assertNoContent();

        $this->assertSoftDeleted('case_notes', ['id' => $note->id]);
    }

    public function test_a_technician_sees_notes_city_wide(): void
    {
        CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        // Another technician's assignment AND another technician's authorship —
        // both still visible: the technician absorbed the old doctor role's
        // city-wide clinical oversight, so there is no assigned-only slice.
        $otherTechnician = User::factory()->create(['role' => 'technician']);
        $other = Beneficiary::factory()->assignedTo($otherTechnician)->create();
        CaseNote::factory()->forBeneficiary($other)->create();

        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes')
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_a_technician_can_read_a_note_on_any_beneficiary_by_id(): void
    {
        $unassigned = Beneficiary::factory()->create(); // nobody's assignment
        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($unassigned)->create();

        // City-wide read scope: an unassigned household is no longer invisible.
        $this->actingAs($this->technician)
            ->getJson("/api/v1/case-notes/{$note->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $note->id);
    }

    public function test_notes_are_returned_newest_first(): void
    {
        $old = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)
            ->create(['date_noted' => now()->subMonth()->toDateString()]);
        $new = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)
            ->create(['date_noted' => now()->toDateString()]);

        $this->actingAs($this->technician)
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
