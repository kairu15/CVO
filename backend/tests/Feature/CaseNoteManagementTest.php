<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\CaseNoteUpdate;
use App\Models\FieldVisit;
use App\Models\HealthRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CaseNoteManagementTest extends TestCase
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
        $this->beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create([
            'name_of_farmer' => 'Nena Cruz',
            'address' => 'Dawis',
            'animal_type' => 'Carabao',
            'sex' => 'F',
        ]);
    }

    private function payload(array $overrides = []): array
    {
        return [
            'beneficiary_id' => $this->beneficiary->id,
            'date_noted' => now()->subDay()->toDateString(),
            'category' => 'illness',
            'status' => 'observation',
            'location' => 'Dawis, near the creek',
            'body' => 'The animal is limping and has a swollen left hoof.',
            'actions_taken' => 'Cleaned the hoof and applied a topical dressing.',
            'recommendations' => 'Keep the animal dry and recheck in three days.',
            'follow_up_on' => now()->addDays(2)->toDateString(),
            ...$overrides,
        ];
    }

    public function test_a_technician_opens_a_case_with_real_case_fields(): void
    {
        $response = $this->actingAs($this->technician)
            ->postJson('/api/v1/case-notes', $this->payload())
            ->assertCreated()
            ->assertJsonPath('data.name_of_farmer', 'Nena Cruz')
            ->assertJsonPath('data.category', 'illness')
            ->assertJsonPath('data.status', 'observation')
            ->assertJsonPath('data.location', 'Dawis, near the creek')
            ->assertJsonPath('data.actions_taken', 'Cleaned the hoof and applied a topical dressing.')
            ->assertJsonPath('data.recommendations', 'Keep the animal dry and recheck in three days.')
            ->assertJsonPath('data.follow_up_on', now()->addDays(2)->toDateString())
            ->assertJsonPath('data.follow_up_status', 'upcoming');

        $this->assertMatchesRegularExpression('/^CN-\d{4}-\d{5}$/', $response->json('data.reference_number'));

        $this->assertDatabaseHas('case_notes', [
            'beneficiary_id' => $this->beneficiary->id,
            'doctor_id' => $this->technician->id,
            'category' => 'illness',
            'status' => 'observation',
        ]);

        $this->assertDatabaseHas('activity_logs', [
            'action' => 'case_note_created',
            'actor_id' => $this->technician->id,
            'target_type' => 'CaseNote',
        ]);
    }

    public function test_the_overview_uses_scoped_database_counts(): void
    {
        CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'status' => CaseNote::STATUS_OPEN,
            'follow_up_on' => now()->subDay()->toDateString(),
            'follow_up_completed_at' => null,
        ]);
        CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'status' => CaseNote::STATUS_OBSERVATION,
            'follow_up_on' => now()->addDay()->toDateString(),
            'follow_up_completed_at' => null,
        ]);
        CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'status' => CaseNote::STATUS_RESOLVED,
            'follow_up_on' => now()->subWeek()->toDateString(),
            'follow_up_completed_at' => now(),
        ]);

        // A different household in another barangay must not inflate counts.
        $other = Beneficiary::factory()->create(['address' => 'Banay Banay']);
        CaseNote::factory()->by($this->technician)->forBeneficiary($other)->create();

        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes/summary')
            ->assertOk()
            ->assertJsonPath('data.total_cases', 4)
            ->assertJsonPath('data.open_cases', 2)
            ->assertJsonPath('data.observation_cases', 1)
            ->assertJsonPath('data.resolved_cases', 1)
            ->assertJsonPath('data.follow_up_upcoming', 1)
            ->assertJsonPath('data.follow_up_overdue', 1)
            ->assertJsonPath('data.follow_up_completed', 1);
    }

    public function test_filters_search_and_sort_are_server_side(): void
    {
        $older = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'reference_number' => null,
            'date_noted' => now()->subDays(10)->toDateString(),
            'category' => 'injury',
            'status' => CaseNote::STATUS_OPEN,
            'body' => 'A deep cut on the right foreleg.',
        ]);

        $newer = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'date_noted' => now()->toDateString(),
            'category' => 'illness',
            'status' => CaseNote::STATUS_OBSERVATION,
            'body' => 'Fever and loss of appetite.',
            'follow_up_on' => now()->subDay()->toDateString(),
        ]);

        $other = Beneficiary::factory()->create([
            'name_of_farmer' => 'Other Farmer',
            'address' => 'Banay Banay',
        ]);
        CaseNote::factory()->by($this->technician)->forBeneficiary($other)->create([
            'category' => 'parasites',
            'body' => 'External parasites found.',
        ]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes?search=foreleg')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $older->id);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes?status=observation')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $newer->id);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes?category=parasites')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name_of_farmer', 'Other Farmer');

        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes?barangay=Dawis')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes?follow_up=overdue')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $newer->id);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes?sort=reference&direction=asc&per_page=1&page=2')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.current_page', 2);

        $this->assertNotNull($older->refresh()->reference_number);
    }

    public function test_detail_returns_the_timeline_and_related_clinical_records(): void
    {
        $health = HealthRecord::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'date_recorded' => now()->subDays(3)->toDateString(),
            'diagnosis' => 'Foot rot',
        ]);
        $visit = FieldVisit::factory()->for($this->beneficiary, 'beneficiary')->create([
            'technician_id' => $this->technician->id,
            'visited_on' => now()->subDays(2)->toDateString(),
            'purpose' => 'follow-up',
            'notes' => 'Rechecked the hoof.',
        ]);

        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'health_record_id' => $health->id,
            'field_visit_id' => $visit->id,
        ]);

        CaseNoteUpdate::create([
            'case_note_id' => $note->id,
            'doctor_id' => $this->technician->id,
            'happened_on' => now()->subDay()->toDateString(),
            'observations' => 'Swelling reduced after treatment.',
            'status' => CaseNote::STATUS_OBSERVATION,
            'health_record_id' => $health->id,
        ]);

        $response = $this->actingAs($this->technician)
            ->getJson("/api/v1/case-notes/{$note->id}")
            ->assertOk()
            ->assertJsonPath('data.health_record_id', $health->id)
            ->assertJsonPath('data.health_record.diagnosis', 'Foot rot')
            ->assertJsonPath('data.field_visit_id', $visit->id)
            ->assertJsonPath('data.field_visit.purpose', 'follow-up')
            ->assertJsonCount(1, 'data.updates')
            ->assertJsonPath('data.updates.0.observations', 'Swelling reduced after treatment.')
            ->assertJsonCount(1, 'data.related_health_records')
            ->assertJsonPath('data.related_health_records.0.diagnosis', 'Foot rot')
            ->assertJsonCount(1, 'data.related_field_visits')
            ->assertJsonPath('data.related_field_visits.0.purpose', 'follow-up');

        $this->assertSame($this->technician->id, $response->json('data.updates.0.doctor.id'));
    }

    public function test_follow_up_notes_are_append_only_and_can_progress_the_case(): void
    {
        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'status' => CaseNote::STATUS_OPEN,
            'follow_up_on' => now()->subDay()->toDateString(),
            'follow_up_completed_at' => null,
        ]);

        $this->actingAs($this->technician)
            ->postJson("/api/v1/case-notes/{$note->id}/updates", [
                'happened_on' => now()->toDateString(),
                'observations' => 'The animal is walking normally again.',
                'actions_taken' => 'No further treatment needed.',
                'recommendations' => 'Monitor for one more week.',
                'status' => CaseNote::STATUS_RESOLVED,
                'follow_up_completed' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('data.observations', 'The animal is walking normally again.')
            ->assertJsonPath('data.status', CaseNote::STATUS_RESOLVED)
            ->assertJsonPath('data.doctor.id', $this->technician->id);

        $note->refresh();

        $this->assertSame(CaseNote::STATUS_RESOLVED, $note->status);
        $this->assertNotNull($note->follow_up_completed_at);
        $this->assertNotNull($note->resolved_at);
        $this->assertDatabaseCount('case_note_updates', 1);

        $this->assertDatabaseHas('activity_logs', [
            'action' => 'case_note_update_added',
            'actor_id' => $this->technician->id,
            'target_id' => $note->id,
        ]);

        // The original observation is untouched by the later update.
        $this->actingAs($this->technician)
            ->getJson("/api/v1/case-notes/{$note->id}")
            ->assertOk()
            ->assertJsonPath('data.body', $note->body)
            ->assertJsonCount(1, 'data.updates');
    }

    public function test_a_status_change_from_the_case_form_creates_a_timeline_entry(): void
    {
        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'status' => CaseNote::STATUS_OPEN,
        ]);

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/case-notes/{$note->id}", [
                'status' => CaseNote::STATUS_RESOLVED,
            ])
            ->assertOk()
            ->assertJsonPath('data.status', CaseNote::STATUS_RESOLVED);

        $this->assertDatabaseHas('case_note_updates', [
            'case_note_id' => $note->id,
            'status' => CaseNote::STATUS_RESOLVED,
            'observations' => 'Status changed from Open to Resolved.',
        ]);
    }

    public function test_a_case_can_complete_and_reopen_its_follow_up(): void
    {
        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'follow_up_on' => now()->subDay()->toDateString(),
            'follow_up_completed_at' => null,
        ]);

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/case-notes/{$note->id}", ['follow_up_completed' => true])
            ->assertOk()
            ->assertJsonPath('data.follow_up_status', 'completed');

        $this->assertDatabaseHas('case_note_updates', [
            'case_note_id' => $note->id,
            'observations' => 'Follow-up marked complete.',
        ]);

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/case-notes/{$note->id}", ['follow_up_completed' => false])
            ->assertOk()
            ->assertJsonPath('data.follow_up_status', 'overdue');

        $this->assertDatabaseHas('case_note_updates', [
            'case_note_id' => $note->id,
            'observations' => 'Follow-up reopened.',
        ]);
    }

    public function test_linked_records_must_belong_to_the_same_household(): void
    {
        $other = Beneficiary::factory()->create();
        $foreignHealth = HealthRecord::factory()->by($this->technician)->forBeneficiary($other)->create();
        $foreignVisit = FieldVisit::factory()->for($other, 'beneficiary')->create();

        $this->actingAs($this->technician)
            ->postJson('/api/v1/case-notes', $this->payload([
                'health_record_id' => $foreignHealth->id,
            ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['health_record_id']);

        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->technician)
            ->postJson("/api/v1/case-notes/{$note->id}/updates", [
                'happened_on' => now()->toDateString(),
                'observations' => 'Linked the wrong visit.',
                'field_visit_id' => $foreignVisit->id,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['field_visit_id']);
    }

    public function test_a_colleague_can_add_a_follow_up_but_an_admin_cannot_author_clinical_notes(): void
    {
        $colleague = User::factory()->create(['role' => 'technician']);
        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($colleague)
            ->postJson("/api/v1/case-notes/{$note->id}/updates", [
                'happened_on' => now()->toDateString(),
                'observations' => 'Colleague rechecked the animal.',
            ])
            ->assertCreated()
            ->assertJsonPath('data.doctor_id', $colleague->id);

        $this->actingAs($this->admin)
            ->postJson("/api/v1/case-notes/{$note->id}/updates", [
                'happened_on' => now()->toDateString(),
                'observations' => 'Admin should not author clinical notes.',
            ])
            ->assertForbidden();

        // Admin may still correct case metadata, just not author observations.
        $this->actingAs($this->admin)
            ->patchJson("/api/v1/case-notes/{$note->id}", ['category' => 'illness'])
            ->assertOk()
            ->assertJsonPath('data.category', 'illness');
    }

    public function test_a_supporting_photo_is_private_and_author_scoped(): void
    {
        Storage::fake('secure');

        $note = CaseNote::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $response = $this->actingAs($this->technician)
            ->post("/api/v1/case-notes/{$note->id}/photo", [
                'image' => UploadedFile::fake()->image('case.jpg')->size(300),
            ])
            ->assertOk()
            ->assertJsonPath('data.has_photo', true);

        $this->assertStringContainsString('expiration=', $response->json('data.photo_url'));
        Storage::disk('secure')->assertExists($note->refresh()->photo_path);

        $this->assertDatabaseHas('activity_logs', [
            'action' => 'case_note_photo_uploaded',
            'target_id' => $note->id,
        ]);

        $colleague = User::factory()->create(['role' => 'technician']);
        $this->actingAs($colleague)
            ->post("/api/v1/case-notes/{$note->id}/photo", [
                'image' => UploadedFile::fake()->image('case.jpg')->size(300),
            ])
            ->assertForbidden();
    }

    public function test_options_and_permissions_are_served_to_the_module(): void
    {
        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes/options')
            ->assertOk()
            ->assertJsonPath('data.categories.0', 'general')
            ->assertJsonPath('data.statuses.0', 'open');

        $this->actingAs($this->technician)
            ->getJson('/api/v1/case-notes/summary')
            ->assertOk();
    }

    public function test_case_audit_actions_are_recognised(): void
    {
        foreach ([
            'case_note_created',
            'case_note_updated',
            'case_note_deleted',
            'case_note_update_added',
            'case_note_photo_uploaded',
        ] as $action) {
            $this->assertContains($action, ActivityLog::ACTIONS);
        }
    }
}
