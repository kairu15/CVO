<?php

namespace Tests\Feature;

use App\Models\Animal;
use App\Models\AnimalType;
use App\Models\Beneficiary;
use App\Models\User;
use App\Support\Barangays;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The animal ownership chain: dispersal, re-dispersal, pass-on, return, void,
 * the flight path drawn from those events, and every rejection rule.
 */
class AnimalDispersalTest extends TestCase
{
    use RefreshDatabase;

    /* ------------------------------------------------------------------ *
     |  Helpers                                                            |
     * ------------------------------------------------------------------ */

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function technician(): User
    {
        return User::factory()->create(['role' => 'technician']);
    }

    /** The master list is seeded by its migration — reuse "Swine (Pig)". */
    private function animalType(): AnimalType
    {
        return AnimalType::query()->where('name', 'Swine (Pig)')->firstOrFail();
    }

    private function beneficiary(?User $technician = null, ?string $address = null): Beneficiary
    {
        return Beneficiary::factory()->create([
            'address' => $address ?? Barangays::all()[0],
            'technician_id' => $technician?->id,
        ]);
    }

    private function disperse(User $actor, Beneficiary $owner, ?Carbon $date = null, ?string $tag = 'TAG-0001'): Animal
    {
        $response = $this->actingAs($actor)->postJson('/api/v1/dispersals', [
            'to_beneficiary_id' => $owner->id,
            'animal_type_id' => $this->animalType()->id,
            'ear_tag_number' => $tag,
            'event_date' => ($date ?? now())->toDateString(),
        ]);

        $response->assertCreated();

        return Animal::findOrFail($response->json('data.animal_id'));
    }

    private function latestEventId(int $animalId): int
    {
        return (int) DB::table('animal_ownership_events')
            ->where('animal_id', $animalId)
            ->where('status', 'active')
            ->orderByDesc('event_date')
            ->orderByDesc('id')
            ->value('id');
    }

    private function redisperse(User $actor, int $animalId, Beneficiary $to, ?Carbon $date = null, ?int $overrideBase = null)
    {
        return $this->actingAs($actor)->postJson("/api/v1/animals/{$animalId}/redispersals", [
            'to_beneficiary_id' => $to->id,
            'base_event_id' => $overrideBase ?? $this->latestEventId($animalId),
            'event_date' => ($date ?? now())->toDateString(),
        ]);
    }

    /* ------------------------------------------------------------------ *
     |  Dispersal                                                          |
     * ------------------------------------------------------------------ */

    public function test_guests_cannot_record_a_dispersal(): void
    {
        $this->postJson('/api/v1/dispersals', [])->assertUnauthorized();
    }

    public function test_admin_disperses_an_animal_and_the_path_starts_at_cvo(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiary();

        $animal = $this->disperse($admin, $owner, now()->subDay());

        $this->assertSame($owner->id, $animal->current_owner_id);
        $this->assertSame(Animal::STATUS_ACTIVE, $animal->status);

        $this->assertDatabaseHas('animal_ownership_events', [
            'animal_id' => $animal->id,
            'event_type' => 'dispersal',
            'from_beneficiary_id' => null,
            'to_beneficiary_id' => $owner->id,
        ]);

        $this->actingAs($admin)
            ->getJson("/api/v1/animals/{$animal->id}/flight-path")
            ->assertOk()
            ->assertJsonPath('data.nodes.0.label', 'CVO')
            ->assertJsonPath('data.nodes.1.owner_id', $owner->id)
            ->assertJsonPath('data.nodes.1.current', true)
            ->assertJsonPath('data.current_owner.id', $owner->id);
    }

    public function test_technician_cannot_disperse_to_an_unassigned_household(): void
    {
        $technician = $this->technician();
        $unassigned = $this->beneficiary(); // nobody's technician

        $this->actingAs($technician)->postJson('/api/v1/dispersals', [
            'to_beneficiary_id' => $unassigned->id,
            'animal_type_id' => $this->animalType()->id,
        ])->assertUnprocessable()->assertJsonValidationErrors(['to_beneficiary_id']);
    }

    public function test_a_duplicate_ear_tag_is_rejected(): void
    {
        $admin = $this->admin();
        $first = $this->beneficiary();
        $second = $this->beneficiary();

        $this->disperse($admin, $first, now(), 'TAG-DUP');

        $this->actingAs($admin)->postJson('/api/v1/dispersals', [
            'to_beneficiary_id' => $second->id,
            'animal_type_id' => $this->animalType()->id,
            'ear_tag_number' => 'TAG-DUP',
        ])->assertUnprocessable()->assertJsonValidationErrors(['ear_tag_number']);
    }

    public function test_a_soft_deleted_beneficiary_cannot_receive_an_animal(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiary();
        $owner->delete();

        $this->actingAs($admin)->postJson('/api/v1/dispersals', [
            'to_beneficiary_id' => $owner->id,
            'animal_type_id' => $this->animalType()->id,
        ])->assertUnprocessable()->assertJsonValidationErrors(['to_beneficiary_id']);
    }

    /* ------------------------------------------------------------------ *
     |  Re-dispersal                                                       |
     * ------------------------------------------------------------------ */

    public function test_re_dispersal_builds_the_path_in_date_order_and_moves_the_owner(): void
    {
        $admin = $this->admin();
        $a = $this->beneficiary(null, Barangays::all()[0]);
        $b = $this->beneficiary(null, Barangays::all()[1]);
        $c = $this->beneficiary(null, Barangays::all()[2]);

        $animal = $this->disperse($admin, $a, now()->subDays(10));

        $this->redisperse($admin, $animal->id, $b, now()->subDays(5))->assertCreated();
        $this->redisperse($admin, $animal->id, $c, now()->subDay())->assertCreated();

        $animal->refresh();
        $this->assertSame($c->id, $animal->current_owner_id);

        $path = $this->actingAs($admin)->getJson("/api/v1/animals/{$animal->id}/flight-path")->assertOk();

        $path->assertJsonPath('data.nodes.0.label', 'CVO')
            ->assertJsonPath('data.nodes.1.owner_id', $a->id)
            ->assertJsonPath('data.nodes.2.owner_id', $b->id)
            ->assertJsonPath('data.nodes.3.owner_id', $c->id)
            ->assertJsonPath('data.nodes.3.current', true)
            ->assertJsonPath('data.current_owner.id', $c->id);

        $this->assertCount(3, $path->json('data.segments'));
    }

    public function test_the_second_of_two_racing_re_dispersals_fails_cleanly(): void
    {
        $admin = $this->admin();
        $a = $this->beneficiary();
        $b = $this->beneficiary();
        $c = $this->beneficiary();

        $animal = $this->disperse($admin, $a);

        // Both clients loaded the same chain state.
        $base = $this->latestEventId($animal->id);

        $this->redisperse($admin, $animal->id, $b, null, $base)->assertCreated();

        // The second writer's view of the chain is now stale.
        $this->redisperse($admin, $animal->id, $c, null, $base)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'stale_event');

        $animal->refresh();
        $this->assertSame($b->id, $animal->current_owner_id);
    }

    public function test_re_dispersal_to_the_same_owner_is_rejected(): void
    {
        $admin = $this->admin();
        $a = $this->beneficiary();

        $animal = $this->disperse($admin, $a);

        $this->redisperse($admin, $animal->id, $a)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['to_beneficiary_id']);
    }

    public function test_a_future_date_is_rejected(): void
    {
        $admin = $this->admin();
        $a = $this->beneficiary();

        $this->actingAs($admin)->postJson('/api/v1/dispersals', [
            'to_beneficiary_id' => $a->id,
            'animal_type_id' => $this->animalType()->id,
            'event_date' => now()->addDay()->toDateString(),
        ])->assertUnprocessable()->assertJsonValidationErrors(['event_date']);
    }

    public function test_a_date_before_the_previous_event_is_rejected(): void
    {
        $admin = $this->admin();
        $a = $this->beneficiary();
        $b = $this->beneficiary();

        $animal = $this->disperse($admin, $a, now()->subDays(5));

        $this->redisperse($admin, $animal->id, $b, now()->subDays(10))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['event_date']);
    }

    public function test_backdating_beyond_the_configured_window_is_rejected(): void
    {
        $admin = $this->admin();
        $a = $this->beneficiary();

        $this->actingAs($admin)->postJson('/api/v1/dispersals', [
            'to_beneficiary_id' => $a->id,
            'animal_type_id' => $this->animalType()->id,
            'event_date' => now()->subDays(400)->toDateString(),
        ])->assertUnprocessable()->assertJsonValidationErrors(['event_date']);
    }

    /* ------------------------------------------------------------------ *
     |  Return / pass-on / void                                            |
     * ------------------------------------------------------------------ */

    public function test_return_to_cvo_clears_the_owner_and_blocks_further_handovers(): void
    {
        $admin = $this->admin();
        $a = $this->beneficiary();

        $animal = $this->disperse($admin, $a);

        $this->actingAs($admin)->postJson("/api/v1/animals/{$animal->id}/returns", [
            'base_event_id' => $this->latestEventId($animal->id),
        ])->assertCreated();

        $animal->refresh();
        $this->assertNull($animal->current_owner_id);
        $this->assertSame(Animal::STATUS_RETURNED, $animal->status);

        // A returned animal is not eligible for another handover.
        $this->redisperse($admin, $animal->id, $this->beneficiary())
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'animal_not_active');
    }

    public function test_pass_on_creates_a_linked_offspring_and_keeps_the_parents_owner(): void
    {
        $admin = $this->admin();
        $parentOwner = $this->beneficiary();
        $newOwner = $this->beneficiary();

        $parent = $this->disperse($admin, $parentOwner, now()->subDay());

        $response = $this->actingAs($admin)->postJson("/api/v1/animals/{$parent->id}/pass-ons", [
            'to_beneficiary_id' => $newOwner->id,
            'ear_tag_number' => 'TAG-OFFSPRING',
            'event_date' => now()->toDateString(),
        ])->assertCreated();

        $offspring = Animal::findOrFail($response->json('data.animal_id'));

        $this->assertSame($parent->id, $offspring->parent_animal_id);
        $this->assertSame($newOwner->id, $offspring->current_owner_id);

        // The parent keeps its own owner.
        $parent->refresh();
        $this->assertSame($parentOwner->id, $parent->current_owner_id);

        $this->assertDatabaseHas('animal_ownership_events', [
            'animal_id' => $offspring->id,
            'event_type' => 'pass_on',
            'from_beneficiary_id' => $parentOwner->id,
            'to_beneficiary_id' => $newOwner->id,
        ]);

        // An offspring chain legitimately starts at the parent's household, so
        // the invariant check must not flag it.
        $this->artisan('ownership:verify')->assertSuccessful();
    }

    public function test_voiding_an_event_recomputes_the_current_owner_and_the_path(): void
    {
        $admin = $this->admin();
        $a = $this->beneficiary();
        $b = $this->beneficiary();
        $c = $this->beneficiary();

        $animal = $this->disperse($admin, $a, now()->subDays(10));
        $this->redisperse($admin, $animal->id, $b, now()->subDays(5))->assertCreated();
        $this->redisperse($admin, $animal->id, $c, now()->subDay())->assertCreated();

        $bToCEvent = $this->latestEventId($animal->id);

        $this->actingAs($admin)->postJson("/api/v1/ownership-events/{$bToCEvent}/void", [
            'void_reason' => 'Recorded against the wrong household.',
        ])->assertOk()->assertJsonPath('data.status', 'voided');

        $animal->refresh();
        $this->assertSame($b->id, $animal->current_owner_id);

        // The voided hop is gone from the default path; the chain ends at B.
        $path = $this->actingAs($admin)->getJson("/api/v1/animals/{$animal->id}/flight-path")->assertOk();

        $path->assertJsonPath('data.nodes.1.owner_id', $a->id)
            ->assertJsonPath('data.nodes.2.owner_id', $b->id)
            ->assertJsonPath('data.current_owner.id', $b->id);

        $this->assertCount(2, $path->json('data.segments'));

        // With voided events included, the voided hop reappears flagged.
        $withVoided = $this->actingAs($admin)
            ->getJson("/api/v1/animals/{$animal->id}/flight-path?include_voided=1")
            ->assertOk();

        $this->assertCount(3, $withVoided->json('data.segments'));
        $this->assertTrue($withVoided->json('data.segments.2.voided'));
    }

    /* ------------------------------------------------------------------ *
     |  Technician visibility + recording scope                            |
     * ------------------------------------------------------------------ */

    public function test_a_technician_sees_assigned_owners_in_full_and_others_masked(): void
    {
        $admin = $this->admin();
        $technician = $this->technician();

        // The technician is assigned only to B.
        $a = $this->beneficiary(null, Barangays::all()[0]);
        $b = $this->beneficiary($technician, Barangays::all()[1]);
        $c = $this->beneficiary(null, Barangays::all()[2]);

        $animal = $this->disperse($admin, $a, now()->subDays(10));
        $this->redisperse($admin, $animal->id, $b, now()->subDays(5))->assertCreated();
        $this->redisperse($admin, $animal->id, $c, now()->subDay())->assertCreated();

        $path = $this->actingAs($technician)
            ->getJson("/api/v1/animals/{$animal->id}/flight-path")
            ->assertOk();

        // A (not assigned) masked and barangay-level; B (assigned) full.
        $path->assertJsonPath('data.nodes.1.masked', true)
            ->assertJsonPath('data.nodes.1.owner_id', null)
            ->assertJsonPath('data.nodes.2.masked', false)
            ->assertJsonPath('data.nodes.2.owner_id', $b->id)
            ->assertJsonPath('data.nodes.3.masked', true);

        $this->assertStringStartsWith('Beneficiary in ', $path->json('data.nodes.1.label'));
    }

    public function test_it_lists_the_animals_a_household_currently_holds(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiary();

        $animal = $this->disperse($admin, $owner);

        $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$owner->id}/animals")
            ->assertOk()
            ->assertJsonPath('data.0.id', $animal->id)
            ->assertJsonPath('data.0.current_owner_id', $owner->id);
    }

    public function test_a_household_with_no_animal_returns_an_empty_list(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiary();

        $this->actingAs($admin)
            ->getJson("/api/v1/beneficiaries/{$owner->id}/animals")
            ->assertOk()
            ->assertJsonPath('data', []);
    }

    public function test_a_technician_cannot_look_up_an_unassigned_households_animals(): void
    {
        $admin = $this->admin();
        $technician = $this->technician();
        $owner = $this->beneficiary(); // not the technician's

        $this->disperse($admin, $owner);

        $this->actingAs($technician)
            ->getJson("/api/v1/beneficiaries/{$owner->id}/animals")
            ->assertForbidden();
    }

    public function test_a_technician_cannot_view_an_animal_outside_their_assignment(): void
    {
        $admin = $this->admin();
        $technician = $this->technician();
        $a = $this->beneficiary(); // not the technician's

        $animal = $this->disperse($admin, $a);

        $this->actingAs($technician)
            ->getJson("/api/v1/animals/{$animal->id}/flight-path")
            ->assertForbidden();
    }

    public function test_a_technician_may_re_disperse_from_an_assigned_owner(): void
    {
        $admin = $this->admin();
        $technician = $this->technician();

        $a = $this->beneficiary($technician);
        $b = $this->beneficiary();

        $animal = $this->disperse($admin, $a);

        $this->redisperse($technician, $animal->id, $b)->assertCreated();

        $animal->refresh();
        $this->assertSame($b->id, $animal->current_owner_id);
    }

    public function test_a_technician_cannot_re_disperse_from_an_unassigned_owner(): void
    {
        $admin = $this->admin();
        $technician = $this->technician();
        $a = $this->beneficiary(); // not the technician's

        $animal = $this->disperse($admin, $a);

        $this->redisperse($technician, $animal->id, $this->beneficiary())->assertForbidden();
    }
}
