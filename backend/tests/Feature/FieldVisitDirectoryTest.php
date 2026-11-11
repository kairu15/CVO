<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\FieldVisit;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FieldVisitDirectoryTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $technician;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
        $this->technician = User::factory()->create(['role' => 'technician']);
    }

    public function test_a_row_reports_household_identity_and_dispersal_context(): void
    {
        $beneficiary = Beneficiary::factory()
            ->assignedTo($this->technician)
            ->create([
                'name_of_farmer' => 'Aling Nena',
                'rsbsa_number' => 'RSBSA-001',
                'ear_tag_number' => 'TAG-77',
            ]);

        $event = DispersalEvent::factory()->initial($beneficiary)->create([
            'dispersal_type' => DispersalEvent::TYPE_RE_DISPERSAL,
            'date_dispersed' => now()->subMonth()->toDateString(),
        ]);

        FieldVisit::factory()
            ->by($this->technician)
            ->forBeneficiary($beneficiary)
            ->create(['dispersal_event_id' => $event->id]);

        $this->actingAs($this->admin)
            ->getJson('/api/v1/field-visits')
            ->assertOk()
            ->assertJsonPath('data.0.name_of_farmer', 'Aling Nena')
            ->assertJsonPath('data.0.rsbsa_number', 'RSBSA-001')
            ->assertJsonPath('data.0.ear_tag_number', 'TAG-77')
            ->assertJsonPath('data.0.barangay', $beneficiary->address)
            ->assertJsonPath('data.0.dispersal.id', $event->id)
            ->assertJsonPath('data.0.dispersal.dispersal_type', DispersalEvent::TYPE_RE_DISPERSAL)
            ->assertJsonPath('data.0.dispersal.date_dispersed', now()->subMonth()->toDateString())
            // The recomputed-per-row duplicate is gone; the stored value is
            // the one the table and the drawer read.
            ->assertJsonMissingPath('data.0.distance_from_registered_m');
    }

    public function test_search_barangay_purpose_date_and_technician_filters_run_before_pagination(): void
    {
        $nena = Beneficiary::factory()
            ->create(['name_of_farmer' => 'Nena Santos', 'address' => 'Banay Banay', 'ear_tag_number' => 'TAG-N1']);
        $doyle = Beneficiary::factory()
            ->create(['name_of_farmer' => 'Doyle Walter', 'address' => 'Dawis', 'ear_tag_number' => 'TAG-D1']);

        FieldVisit::factory()->by($this->technician)->forBeneficiary($nena)->create([
            'visited_on' => now()->subDays(2)->toDateString(),
            'purpose' => 'follow-up',
        ]);
        FieldVisit::factory()->by($this->admin)->forBeneficiary($doyle)->create([
            'visited_on' => now()->subDays(40)->toDateString(),
            'purpose' => 'complaint',
        ]);

        // Search covers the ear tag, not just the farmer's name.
        $this->actingAs($this->admin)
            ->getJson('/api/v1/field-visits?search=TAG-N1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name_of_farmer', 'Nena Santos');

        $this->actingAs($this->admin)
            ->getJson('/api/v1/field-visits?barangay=Dawis')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name_of_farmer', 'Doyle Walter');

        $this->actingAs($this->admin)
            ->getJson('/api/v1/field-visits?purpose=follow-up&technician='.$this->technician->id)
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->actingAs($this->admin)
            ->getJson('/api/v1/field-visits?from='.now()->subDays(5)->toDateString())
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name_of_farmer', 'Nena Santos');
    }

    public function test_the_summary_is_scoped_and_the_export_streams_the_filtered_log(): void
    {
        $beneficiary = Beneficiary::factory()->create(['name_of_farmer' => 'Aling Nena']);

        FieldVisit::factory()->by($this->technician)->forBeneficiary($beneficiary)->create([
            'visited_on' => now()->subDays(3)->toDateString(),
        ]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/field-visits/summary')
            ->assertOk()
            ->assertJsonPath('data.total', 1)
            ->assertJsonPath('data.visits_30d', 1);

        // The strip counts the same rows the list serves this viewer. Staff
        // see the office's log, so the admin's figure matches.
        $this->actingAs($this->admin)
            ->getJson('/api/v1/field-visits/summary')
            ->assertOk()
            ->assertJsonPath('data.total', 1);

        $response = $this->actingAs($this->admin)
            ->get('/api/v1/field-visits/export?search=Aling', [
                'Accept' => 'text/csv',
            ]);

        $response->assertOk();
        $this->assertStringContainsString('text/csv', (string) $response->headers->get('content-type'));
        $this->assertStringContainsString('Aling Nena', $response->streamedContent());
        // fputcsv quotes headers containing spaces, so assert the prefix.
        $this->assertStringContainsString('Date,Farmer', $response->streamedContent());
    }

    public function test_the_due_worklist_lists_assigned_households_with_no_recent_contact(): void
    {
        Beneficiary::factory()
            ->assignedTo($this->technician)
            ->create(['name_of_farmer' => 'Overdue Household']);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/field-visits/visits-due')
            ->assertOk()
            ->assertJsonPath('data.total', 1)
            ->assertJsonPath('data.households.0.name_of_farmer', 'Overdue Household')
            ->assertJsonPath('data.window_days', 60);
    }

    public function test_a_disbursal_visit_can_cite_one_of_the_households_own_dispersals(): void
    {
        $beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create();
        $event = DispersalEvent::factory()->initial($beneficiary)->create();

        $this->actingAs($this->technician)
            ->postJson('/api/v1/field-visits', [
                'beneficiary_id' => $beneficiary->id,
                'dispersal_event_id' => $event->id,
                'visited_on' => now()->toDateString(),
                'purpose' => 'dispersal',
                'has_photo' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('data.dispersal_event_id', $event->id);

        $this->assertDatabaseHas('field_visits', [
            'beneficiary_id' => $beneficiary->id,
            'dispersal_event_id' => $event->id,
        ]);
    }

    public function test_a_single_dispersal_is_attached_automatically_for_a_dispersal_visit(): void
    {
        $beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create();
        $event = DispersalEvent::factory()->initial($beneficiary)->create();

        $this->actingAs($this->technician)
            ->postJson('/api/v1/field-visits', [
                'beneficiary_id' => $beneficiary->id,
                'visited_on' => now()->toDateString(),
                'purpose' => 'dispersal',
                'has_photo' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('data.dispersal_event_id', $event->id);
    }

    public function test_a_visit_cannot_cite_another_households_dispersal(): void
    {
        $visited = Beneficiary::factory()->assignedTo($this->technician)->create();
        $other = Beneficiary::factory()->create();
        $foreign = DispersalEvent::factory()->initial($other)->create();

        $this->actingAs($this->technician)
            ->postJson('/api/v1/field-visits', [
                'beneficiary_id' => $visited->id,
                'dispersal_event_id' => $foreign->id,
                'visited_on' => now()->toDateString(),
                'purpose' => 'dispersal',
                'has_photo' => true,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['dispersal_event_id']);
    }
}
