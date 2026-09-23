<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\User;
use App\Services\FieldVisitService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FieldVisitTest extends TestCase
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

    public function test_technician_can_log_a_trip_with_an_on_site_gps_fix(): void
    {
        $response = $this->actingAs($this->technician)->postJson('/api/v1/field-visits', [
            'beneficiary_id' => $this->beneficiary->id,
            'visited_on' => now()->toDateString(),
            'purpose' => 'routine-monitoring',
            'latitude' => 9.3714,
            'longitude' => 122.80916,
            'notes' => 'Checked the carabao, in good condition.',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.purpose', 'routine-monitoring')
            ->assertJsonPath('data.technician_id', $this->technician->id)
            ->assertJsonPath('data.name_of_farmer', $this->beneficiary->name_of_farmer)
            ->assertJsonPath('data.has_location', true);

        $this->assertDatabaseHas('field_visits', [
            'beneficiary_id' => $this->beneficiary->id,
            'technician_id' => $this->technician->id,
            'purpose' => 'routine-monitoring',
        ]);
    }

    /**
     * The distinction the whole module rests on: a visit can produce no animal
     * observation at all, and must still be loggable.
     */
    public function test_a_trip_can_be_logged_with_no_gps_fix_and_no_animal_data(): void
    {
        $response = $this->actingAs($this->technician)->postJson('/api/v1/field-visits', [
            'beneficiary_id' => $this->beneficiary->id,
            'visited_on' => now()->toDateString(),
            'purpose' => 'follow-up',
            'notes' => 'Nobody home, left a note for the owner.',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.has_location', false)
            ->assertJsonPath('data.latitude', null)
            ->assertJsonPath('data.distance_from_registered_m', null);
    }

    public function test_a_half_captured_fix_is_rejected(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/field-visits', [
                'beneficiary_id' => $this->beneficiary->id,
                'visited_on' => now()->toDateString(),
                'purpose' => 'routine-monitoring',
                'latitude' => 9.3714,
                // longitude missing
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['longitude']);
    }

    public function test_out_of_range_coordinates_are_rejected(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/field-visits', [
                'beneficiary_id' => $this->beneficiary->id,
                'visited_on' => now()->toDateString(),
                'purpose' => 'routine-monitoring',
                'latitude' => 120,
                'longitude' => 400,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['latitude', 'longitude']);
    }

    public function test_the_technician_is_taken_from_the_session_not_the_payload(): void
    {
        $other = User::factory()->create(['role' => 'technician']);

        $this->actingAs($this->technician)
            ->postJson('/api/v1/field-visits', [
                'beneficiary_id' => $this->beneficiary->id,
                'visited_on' => now()->toDateString(),
                'purpose' => 'other',
                'technician_id' => $other->id,
            ])
            ->assertCreated()
            ->assertJsonPath('data.technician_id', $this->technician->id);
    }

    public function test_only_technicians_can_log_a_trip(): void
    {
        $payload = [
            'beneficiary_id' => $this->beneficiary->id,
            'visited_on' => now()->toDateString(),
            'purpose' => 'routine-monitoring',
        ];

        foreach (['doctor', 'farmer', 'admin'] as $role) {
            $this->actingAs(User::factory()->create(['role' => $role]))
                ->postJson('/api/v1/field-visits', $payload)
                ->assertForbidden();
        }
    }

    public function test_create_validates_the_purpose_and_required_fields(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/field-visits', [
                'beneficiary_id' => $this->beneficiary->id,
                'purpose' => 'sightseeing',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['visited_on', 'purpose']);
    }

    public function test_the_distance_from_the_registered_pin_is_reported(): void
    {
        // The beneficiary's registered pin.
        $this->beneficiary->update(['latitude' => 9.3714, 'longitude' => 122.80916]);

        // A fix captured about 1.1 km away.
        $visit = FieldVisit::factory()
            ->by($this->technician)
            ->forBeneficiary($this->beneficiary)
            ->create(['latitude' => 9.3814, 'longitude' => 122.80916]);

        $response = $this->actingAs($this->technician)->getJson("/api/v1/field-visits/{$visit->id}");

        $response->assertOk()->assertJsonPath('data.has_location', true);

        $distance = $response->json('data.distance_from_registered_m');
        $this->assertGreaterThan(1000, $distance);
        $this->assertLessThan(1200, $distance);
    }

    public function test_the_author_can_correct_their_own_trip_but_not_a_colleagues(): void
    {
        $visit = FieldVisit::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/field-visits/{$visit->id}", ['notes' => 'Corrected note.'])
            ->assertOk()
            ->assertJsonPath('data.notes', 'Corrected note.');

        $colleague = User::factory()->create(['role' => 'technician']);

        $this->actingAs($colleague)
            ->patchJson("/api/v1/field-visits/{$visit->id}", ['notes' => 'Rewriting.'])
            ->assertForbidden();
    }

    public function test_a_trip_cannot_be_reassigned_to_another_technician_or_farm(): void
    {
        $visit = FieldVisit::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();
        $other = Beneficiary::factory()->create();
        $otherTechnician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/field-visits/{$visit->id}", [
                'beneficiary_id' => $other->id,
                'technician_id' => $otherTechnician->id,
                'notes' => 'Falsified.',
            ])
            ->assertOk();

        // Neither identity field is accepted, so the log stays truthful.
        $this->assertDatabaseHas('field_visits', [
            'id' => $visit->id,
            'beneficiary_id' => $this->beneficiary->id,
            'technician_id' => $this->technician->id,
        ]);
    }

    public function test_the_author_can_delete_their_own_trip(): void
    {
        $visit = FieldVisit::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($this->technician)
            ->deleteJson("/api/v1/field-visits/{$visit->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('field_visits', ['id' => $visit->id]);
    }

    /**
     * The technician scope is by visiting technician, not by assigned
     * beneficiary — a deliberate departure from every other module, because a
     * visit is the technician's own activity log.
     */
    public function test_a_technician_sees_their_own_trips_even_for_another_technicians_beneficiary(): void
    {
        $otherTechnician = User::factory()->create(['role' => 'technician']);
        $otherBeneficiary = Beneficiary::factory()->assignedTo($otherTechnician)->create();

        // Our technician visits a farm assigned to someone else.
        $mine = FieldVisit::factory()->by($this->technician)->forBeneficiary($otherBeneficiary)->create();
        // And a trip they did not make.
        FieldVisit::factory()->by($otherTechnician)->forBeneficiary($otherBeneficiary)->create();

        $this->actingAs($this->technician)
            ->getJson('/api/v1/field-visits')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $mine->id);
    }

    public function test_a_farmer_sees_the_visits_made_to_their_animals(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $own = Beneficiary::factory()->forFarmer($farmer)->create();
        $visit = FieldVisit::factory()->by($this->technician)->forBeneficiary($own)->create();

        FieldVisit::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $this->actingAs($farmer)
            ->getJson('/api/v1/field-visits')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $visit->id);
    }

    public function test_a_farmer_cannot_read_another_farmers_visit_by_id(): void
    {
        $visit = FieldVisit::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($farmer)
            ->getJson("/api/v1/field-visits/{$visit->id}")
            ->assertNotFound();
    }

    public function test_visits_are_returned_newest_first(): void
    {
        $old = FieldVisit::factory()->by($this->technician)->forBeneficiary($this->beneficiary)
            ->create(['visited_on' => now()->subMonth()->toDateString()]);
        $new = FieldVisit::factory()->by($this->technician)->forBeneficiary($this->beneficiary)
            ->create(['visited_on' => now()->toDateString()]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/field-visits')
            ->assertOk()
            ->assertJsonPath('data.0.id', $new->id)
            ->assertJsonPath('data.1.id', $old->id);
    }

    public function test_the_purpose_vocabulary_is_served_to_the_form(): void
    {
        $this->actingAs($this->technician)
            ->getJson('/api/v1/field-visits/options')
            ->assertOk()
            ->assertJsonPath('data.purposes', config('cvo.field_visit_purposes'));
    }

    public function test_the_distance_helper_is_null_safe(): void
    {
        $this->assertNull(FieldVisitService::distanceMeters(null, null, 9.1, 122.1));
        $this->assertNull(FieldVisitService::distanceMeters(9.1, 122.1, null, null));
        $this->assertSame(0, FieldVisitService::distanceMeters(9.1, 122.1, 9.1, 122.1));
    }

    public function test_guests_are_rejected(): void
    {
        $this->getJson('/api/v1/field-visits')->assertUnauthorized();
    }
}
