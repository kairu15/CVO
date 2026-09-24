<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DispersalEventTest extends TestCase
{
    use RefreshDatabase;

    public function test_guests_cannot_list_dispersal_events(): void
    {
        $this->getJson('/api/v1/dispersal-events')->assertUnauthorized();
    }

    public function test_farmer_can_record_initial_dispersal_with_coordinates(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->create();

        $response = $this->actingAs($farmer)->postJson('/api/v1/dispersal-events', [
            'beneficiary_id' => $beneficiary->id,
            'dispersal_type' => 'initial',
            'date_dispersed' => '2026-09-01',
            'remarks' => 'First program dispersal.',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.dispersal_type', 'initial')
            ->assertJsonPath('data.beneficiary_id', $beneficiary->id);

        $this->assertDatabaseHas('dispersal_events', [
            'beneficiary_id' => $beneficiary->id,
            'new_beneficiary_id' => $beneficiary->id,
            'dispersal_type' => 'initial',
        ]);
    }

    public function test_technician_can_record_re_dispersal_registering_new_recipient_inline(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $source = Beneficiary::factory()->assignedTo($technician)->create();

        $response = $this->actingAs($technician)->postJson('/api/v1/dispersal-events', [
            'beneficiary_id' => $source->id,
            'dispersal_type' => 're-dispersal',
            'parent_beneficiary_id' => $source->id,
            'register_new' => true,
            'new_name_of_farmer' => 'Rodrigo Pasahan',
            'new_address' => 'Kalumboyan',
            'new_animal_type' => 'Carabao',
            'new_sex' => 'F',
            'new_latitude' => 9.5306,
            'new_longitude' => 122.8694,
            'date_dispersed' => '2026-09-10',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.dispersal_type', 're-dispersal');

        $this->assertDatabaseHas('beneficiaries', [
            'name_of_farmer' => 'Rodrigo Pasahan',
            'address' => 'Kalumboyan',
            'latitude' => 9.5306,
        ]);

        $newId = Beneficiary::where('name_of_farmer', 'Rodrigo Pasahan')->value('id');
        $this->assertDatabaseHas('dispersal_events', [
            'beneficiary_id' => $newId,
            'parent_beneficiary_id' => $source->id,
            'new_beneficiary_id' => $newId,
        ]);
    }

    public function test_re_dispersal_requires_a_parent(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $source = Beneficiary::factory()->assignedTo($technician)->create();

        $this->actingAs($technician)
            ->postJson('/api/v1/dispersal-events', [
                'beneficiary_id' => $source->id,
                'dispersal_type' => 're-dispersal',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['parent_beneficiary_id']);
    }

    public function test_initial_dispersal_rejects_a_parent(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->create();
        $other = Beneficiary::factory()->create();

        $this->actingAs($farmer)
            ->postJson('/api/v1/dispersal-events', [
                'beneficiary_id' => $beneficiary->id,
                'dispersal_type' => 'initial',
                'parent_beneficiary_id' => $other->id,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['parent_beneficiary_id']);
    }

    public function test_technician_cannot_record_dispersal_for_unassigned_beneficiary(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $unassigned = Beneficiary::factory()->create(); // no technician

        $response = $this->actingAs($technician)->postJson('/api/v1/dispersal-events', [
            'beneficiary_id' => $unassigned->id,
            'dispersal_type' => 'initial',
        ]);

        // The policy blocks create for beneficiaries outside the
        // technician's scope — surfaced as a validation failure on the
        // beneficiary id (the FormRequest scopes the exists rule).
        $this->assertTrue(in_array($response->status(), [403, 422]));
    }

    public function test_farmer_sees_only_their_own_dispersal_events(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $mine = Beneficiary::factory()->forFarmer($farmer)->create();
        DispersalEvent::factory()->initial($mine)->create();
        DispersalEvent::factory()->create(); // someone else's

        $this->actingAs($farmer)
            ->getJson('/api/v1/dispersal-events')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_lineage_returns_the_pass_on_chain(): void
    {
        $original = Beneficiary::factory()->create([
            'name_of_farmer' => 'Original Farmer',
            'address' => 'Banaybanay',
        ]);

        $recipient = Beneficiary::factory()->create([
            'name_of_farmer' => 'Second Farmer',
            'address' => 'Kalumboyan',
        ]);

        DispersalEvent::factory()->initial($original)->create();
        DispersalEvent::factory()->reDispersal($recipient, $original)->create();

        $admin = User::factory()->create(['role' => 'admin']);

        // Viewing the recipient's lineage walks back to the original household.
        $response = $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$recipient->id}/lineage")
            ->assertOk();

        $response->assertJsonPath('data.beneficiary.name_of_farmer', 'Second Farmer');

        $chain = $response->json('data.chain');
        $this->assertCount(2, $chain);
        $this->assertSame('Original Farmer', $chain[0]['name_of_farmer']);
        $this->assertFalse($chain[0]['is_current']);
        $this->assertSame('Second Farmer', $chain[1]['name_of_farmer']);
        $this->assertTrue($chain[1]['is_current']);

        // A re-dispersal recipient has no offspring of its own yet.
        $this->assertCount(0, $response->json('data.descendant_events'));
    }

    public function test_lineage_is_404_for_beneficiary_without_dispersal(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create();

        $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$beneficiary->id}/lineage")
            ->assertNotFound();
    }

    public function test_lineage_from_the_original_household_lists_descendants(): void
    {
        $original = Beneficiary::factory()->create(['name_of_farmer' => 'Root Farmer']);
        $recipient = Beneficiary::factory()->create(['name_of_farmer' => 'Branch Farmer']);

        DispersalEvent::factory()->initial($original)->create();
        DispersalEvent::factory()->reDispersal($recipient, $original)->create();

        $admin = User::factory()->create(['role' => 'admin']);

        $response = $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$original->id}/lineage")
            ->assertOk();

        // Viewing from the root: the chain is only the original household,
        // and the offspring hop appears as a descendant.
        $this->assertCount(1, $response->json('data.chain'));

        $descendants = $response->json('data.descendant_events');
        $this->assertCount(1, $descendants);
        $this->assertSame('Branch Farmer', $descendants[0]['name_of_farmer']);
    }

    public function test_lineage_walks_back_to_the_original_dispersal(): void
    {
        $root = Beneficiary::factory()->create(['name_of_farmer' => 'Root Farmer']);
        $mid = Beneficiary::factory()->create(['name_of_farmer' => 'Mid Farmer']);
        $leaf = Beneficiary::factory()->create(['name_of_farmer' => 'Leaf Farmer']);

        DispersalEvent::factory()->initial($root)->create();
        DispersalEvent::factory()->reDispersal($mid, $root)->create();
        DispersalEvent::factory()->reDispersal($leaf, $mid)->create();

        $admin = User::factory()->create(['role' => 'admin']);

        $response = $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$leaf->id}/lineage")
            ->assertOk();

        $chain = $response->json('data.chain');
        $this->assertCount(3, $chain);
        $this->assertSame('Root Farmer', $chain[0]['name_of_farmer']);
        $this->assertSame('Mid Farmer', $chain[1]['name_of_farmer']);
        $this->assertSame('Leaf Farmer', $chain[2]['name_of_farmer']);
        $this->assertSame('initial', $chain[0]['dispersal_type']);
        $this->assertSame('re-dispersal', $chain[2]['dispersal_type']);
    }

    public function test_farmer_cannot_read_another_farmers_lineage(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()->create();
        DispersalEvent::factory()->initial($beneficiary)->create();

        $this->actingAs($farmer)
            ->getJson("/api/v1/beneficiaries/{$beneficiary->id}/lineage")
            ->assertNotFound();
    }

    public function test_beneficiary_store_accepts_coordinates(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($farmer)
            ->postJson('/api/v1/beneficiaries', [
                'name_of_farmer' => 'Geo Farmer',
                'address' => 'Banaybanay',
                'animal_type' => 'Goat',
                'sex' => 'F',
                'latitude' => 9.5538,
                'longitude' => 122.8229,
            ])
            ->assertCreated()
            ->assertJsonPath('data.latitude', 9.5538)
            ->assertJsonPath('data.longitude', 122.8229);
    }

    public function test_beneficiary_store_rejects_out_of_range_coordinates(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($farmer)
            ->postJson('/api/v1/beneficiaries', [
                'name_of_farmer' => 'Geo Farmer',
                'address' => 'Banaybanay',
                'animal_type' => 'Goat',
                'sex' => 'F',
                'latitude' => 200,
                'longitude' => 122.8229,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['latitude']);
    }

    public function test_farmer_can_geo_tag_their_own_beneficiary(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->create();

        $this->actingAs($farmer)
            ->putJson("/api/v1/beneficiaries/{$beneficiary->id}", [
                'latitude' => 9.4,
                'longitude' => 122.8,
            ])
            ->assertOk()
            ->assertJsonPath('data.latitude', 9.4);
    }
}
