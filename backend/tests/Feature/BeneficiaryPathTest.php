<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\FieldVisit;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BeneficiaryPathTest extends TestCase
{
    use RefreshDatabase;

    public function test_guests_cannot_read_a_flight_path(): void
    {
        $beneficiary = Beneficiary::factory()->create();

        $this->getJson("/api/v1/beneficiaries/{$beneficiary->id}/path")
            ->assertUnauthorized();
    }

    public function test_path_orders_points_by_event_date_not_insertion_order(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create([
            'latitude' => 9.40000,
            'longitude' => 122.80000,
        ]);

        DispersalEvent::factory()->initial($beneficiary)->create([
            'date_dispersed' => '2026-01-10',
        ]);

        // Inserted newest-first: if ordering came from the id, the June visit
        // would be drawn before the March one and the arrow would point
        // backwards in time.
        FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'visited_on' => '2026-06-15',
            'latitude' => 9.41000,
            'longitude' => 122.81000,
            'purpose' => 'Follow-up',
            'notes' => 'Second trip.',
        ]);
        FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'visited_on' => '2026-03-12',
            'latitude' => 9.40500,
            'longitude' => 122.80500,
            'purpose' => 'Routine check',
            'notes' => null,
        ]);
        // A visit without a GPS fix is still a visit, but it is not a
        // location — it must not appear as a point on the trail.
        FieldVisit::factory()->forBeneficiary($beneficiary)->withoutLocation()->create([
            'visited_on' => '2026-05-01',
            'purpose' => 'Follow-up',
        ]);

        $response = $this->actingAs($technician)
            ->getJson("/api/v1/beneficiaries/{$beneficiary->id}/path")
            ->assertOk();

        $this->assertSame(
            ['origin', 'field-visit', 'field-visit', 'current'],
            array_column($response->json('data.points'), 'kind'),
        );

        $points = $response->json('data.points');
        $this->assertSame('2026-01-10', $points[0]['occurred_on']);
        $this->assertSame('2026-03-12', $points[1]['occurred_on']);
        $this->assertSame('2026-06-15', $points[2]['occurred_on']);
        $this->assertSame('Routine check', $points[1]['subtitle']);
        $this->assertSame('Follow-up — Second trip.', $points[2]['subtitle']);
    }

    public function test_re_dispersal_path_starts_at_the_parent_household(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $parent = Beneficiary::factory()->create([
            'name_of_farmer' => 'Original Farmer',
            'latitude' => 9.30000,
            'longitude' => 122.70000,
        ]);
        $recipient = Beneficiary::factory()->create([
            'name_of_farmer' => 'Second Farmer',
            'latitude' => 9.50000,
            'longitude' => 122.90000,
        ]);

        DispersalEvent::factory()->reDispersal($recipient, $parent)->create([
            'date_dispersed' => '2026-02-20',
        ]);

        $points = $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$recipient->id}/path")
            ->assertOk()
            ->json('data.points');

        // The animal's story starts where it came from, not at the pin of the
        // household that received it — otherwise the trail starts and ends on
        // the same point.
        $this->assertSame('origin', $points[0]['kind']);
        $this->assertSame('Re-dispersal origin', $points[0]['title']);
        $this->assertSame('2026-02-20', $points[0]['occurred_on']);
        $this->assertSame(9.3, (float) $points[0]['latitude']);
        // The trail is anchored to the PARENT's pin so it meets the marker the
        // map draws for the household it started at.
        $this->assertSame($parent->id, $points[0]['anchor_id']);
        $this->assertSame('Original Farmer · '.$parent->address, $points[0]['subtitle']);

        $last = $points[array_key_last($points)];
        $this->assertSame('current', $last['kind']);
        $this->assertSame(9.5, (float) $last['latitude']);
        $this->assertSame($recipient->id, $last['anchor_id']);
    }

    public function test_a_path_with_no_visits_collapses_to_one_point(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create([
            'latitude' => 9.40000,
            'longitude' => 122.80000,
        ]);

        DispersalEvent::factory()->initial($beneficiary)->create([
            'date_dispersed' => '2026-04-01',
        ]);

        $points = $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$beneficiary->id}/path")
            ->assertOk()
            ->json('data.points');

        // Origin and current pin share coordinates; a zero-length segment
        // would render as an arrowhead frozen in place, so the duplicate is
        // collapsed and the client simply draws nothing yet.
        $this->assertCount(1, $points);
        $this->assertSame('origin', $points[0]['kind']);
    }

    public function test_an_assigned_technician_reads_the_path_and_an_unassigned_one_is_refused(): void
    {
        $assigned = User::factory()->create(['role' => 'technician']);
        $other = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($assigned)->create();
        DispersalEvent::factory()->initial($beneficiary)->create([
            'date_dispersed' => '2026-03-03',
        ]);

        $this->actingAs($assigned)
            ->getJson("/api/v1/beneficiaries/{$beneficiary->id}/path")
            ->assertOk();

        // A permissions boundary, not a missing row: a silent 404 would read
        // as a bug rather than an access rule (same rule as show()).
        $this->actingAs($other)
            ->getJson("/api/v1/beneficiaries/{$beneficiary->id}/path")
            ->assertForbidden();
    }

    public function test_a_doctor_reads_city_wide_paths(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor']);
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();

        $this->actingAs($doctor)
            ->getJson("/api/v1/beneficiaries/{$beneficiary->id}/path")
            ->assertOk();
    }

    public function test_an_unknown_beneficiary_answers_not_found(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->getJson('/api/v1/beneficiaries/999999/path')
            ->assertNotFound();
    }
}
