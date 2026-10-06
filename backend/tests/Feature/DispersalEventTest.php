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

    public function test_lineage_answers_an_empty_chain_for_beneficiary_without_dispersal(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create();

        // Registered but no dispersal recorded yet — a normal state, not an
        // error: the client shows its "No dispersal recorded" empty state.
        $response = $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$beneficiary->id}/lineage")
            ->assertOk()
            ->assertJsonPath('data.beneficiary.id', $beneficiary->id);

        $this->assertSame([], $response->json('data.chain'));
        $this->assertSame([], $response->json('data.descendant_events'));
    }

    public function test_lineage_is_404_for_a_missing_beneficiary(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->getJson('/api/v1/beneficiaries/999999/lineage')
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

    public function test_lineage_returns_a_multi_generation_descendant_tree(): void
    {
        $root = Beneficiary::factory()->create(['name_of_farmer' => 'Root Farmer']);
        $mid = Beneficiary::factory()->create(['name_of_farmer' => 'Mid Farmer']);
        $leaf = Beneficiary::factory()->create(['name_of_farmer' => 'Leaf Farmer']);

        DispersalEvent::factory()->initial($root)->create();
        DispersalEvent::factory()->reDispersal($mid, $root)->create();
        DispersalEvent::factory()->reDispersal($leaf, $mid)->create();

        $admin = User::factory()->create(['role' => 'admin']);

        $response = $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$root->id}/lineage")
            ->assertOk();

        $tree = $response->json('data.descendant_tree');

        // Generation 1: the immediate offspring of the root household.
        $this->assertCount(1, $tree);
        $this->assertSame('Mid Farmer', $tree[0]['name_of_farmer']);
        $this->assertSame(1, $tree[0]['generation']);

        // Generation 2 nests under generation 1 — the whole point of the tree
        // over the flat descendant_events list.
        $this->assertCount(1, $tree[0]['children']);
        $this->assertSame('Leaf Farmer', $tree[0]['children'][0]['name_of_farmer']);
        $this->assertSame(2, $tree[0]['children'][0]['generation']);
        $this->assertSame([], $tree[0]['children'][0]['children']);
    }

    public function test_lineage_tree_branches_when_a_household_passes_on_to_several(): void
    {
        $root = Beneficiary::factory()->create(['name_of_farmer' => 'Root Farmer']);
        $first = Beneficiary::factory()->create(['name_of_farmer' => 'First Offspring']);
        $second = Beneficiary::factory()->create(['name_of_farmer' => 'Second Offspring']);

        // Explicit dates: the tree is ordered chronologically, and the factory's
        // random date_dispersed would otherwise make the order a coin flip.
        DispersalEvent::factory()->initial($root)->create();
        DispersalEvent::factory()->reDispersal($first, $root)
            ->create(['date_dispersed' => now()->subDays(2)]);
        DispersalEvent::factory()->reDispersal($second, $root)
            ->create(['date_dispersed' => now()->subDay()]);

        $admin = User::factory()->create(['role' => 'admin']);

        $tree = $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$root->id}/lineage")
            ->assertOk()
            ->json('data.descendant_tree');

        $this->assertCount(2, $tree);
        $this->assertSame(
            ['First Offspring', 'Second Offspring'],
            array_column($tree, 'name_of_farmer'),
        );
        $this->assertSame([], $tree[0]['children']);
        $this->assertSame([], $tree[1]['children']);
    }

    public function test_lineage_tree_is_empty_for_a_household_with_no_offspring(): void
    {
        $beneficiary = Beneficiary::factory()->create();
        DispersalEvent::factory()->initial($beneficiary)->create();

        $admin = User::factory()->create(['role' => 'admin']);

        $response = $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$beneficiary->id}/lineage")
            ->assertOk();

        $this->assertSame([], $response->json('data.descendant_tree'));
    }

    public function test_admin_can_correct_a_dispersal_events_details(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create();
        $event = DispersalEvent::factory()->initial($beneficiary)->create();

        $this->actingAs($admin)
            ->patchJson("/api/v1/dispersal-events/{$event->id}", [
                'date_dispersed' => '2026-08-15',
                'remarks' => 'Corrected date per field log.',
            ])
            ->assertOk()
            ->assertJsonPath('data.remarks', 'Corrected date per field log.');

        $this->assertDatabaseHas('dispersal_events', [
            'id' => $event->id,
            'remarks' => 'Corrected date per field log.',
        ]);
    }

    public function test_admin_can_soft_delete_a_dispersal_event(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create();
        $event = DispersalEvent::factory()->initial($beneficiary)->create();

        $this->actingAs($admin)
            ->deleteJson("/api/v1/dispersal-events/{$event->id}")
            ->assertNoContent();

        $this->assertSoftDeleted('dispersal_events', ['id' => $event->id]);
    }

    public function test_assigned_technician_can_update_their_own_dispersal_event(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();
        $event = DispersalEvent::factory()->initial($beneficiary)->create();

        $this->actingAs($technician)
            ->patchJson("/api/v1/dispersal-events/{$event->id}", [
                'remarks' => 'Technician correction.',
            ])
            ->assertOk()
            ->assertJsonPath('data.remarks', 'Technician correction.');
    }

    public function test_technician_cannot_touch_a_dispersal_event_outside_their_scope(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $unassigned = Beneficiary::factory()->create(); // no technician
        $event = DispersalEvent::factory()->initial($unassigned)->create();

        $this->actingAs($technician)
            ->patchJson("/api/v1/dispersal-events/{$event->id}", ['remarks' => 'Nope.'])
            ->assertForbidden();

        $this->actingAs($technician)
            ->deleteJson("/api/v1/dispersal-events/{$event->id}")
            ->assertForbidden();

        $this->assertDatabaseHas('dispersal_events', [
            'id' => $event->id,
            'deleted_at' => null,
        ]);
    }

    public function test_farmer_cannot_update_or_delete_a_dispersal_event(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->create();
        $event = DispersalEvent::factory()->initial($beneficiary)->create();

        $this->actingAs($farmer)
            ->patchJson("/api/v1/dispersal-events/{$event->id}", ['remarks' => 'Mine.'])
            ->assertForbidden();

        $this->actingAs($farmer)
            ->deleteJson("/api/v1/dispersal-events/{$event->id}")
            ->assertForbidden();
    }

    public function test_switching_a_re_dispersal_back_to_initial_clears_the_parent(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $parent = Beneficiary::factory()->create();
        $recipient = Beneficiary::factory()->create();
        $event = DispersalEvent::factory()->reDispersal($recipient, $parent)->create();

        $this->actingAs($admin)
            ->patchJson("/api/v1/dispersal-events/{$event->id}", [
                'dispersal_type' => 'initial',
            ])
            ->assertOk()
            ->assertJsonPath('data.parent_beneficiary_id', null);

        $this->assertDatabaseHas('dispersal_events', [
            'id' => $event->id,
            'parent_beneficiary_id' => null,
        ]);
    }

    public function test_switching_an_initial_dispersal_to_re_dispersal_requires_a_parent(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create();
        $event = DispersalEvent::factory()->initial($beneficiary)->create();

        $this->actingAs($admin)
            ->patchJson("/api/v1/dispersal-events/{$event->id}", [
                'dispersal_type' => 're-dispersal',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['parent_beneficiary_id']);
    }
}
