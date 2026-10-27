<?php

namespace Tests\Feature;

use App\Models\Animal;
use App\Models\AnimalOwnershipEvent;
use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * `ownership:backfill` — turning the legacy beneficiary pass-on records into
 * animals + ownership events, idempotently and with a safe dry run.
 */
class OwnershipBackfillTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_dry_run_writes_nothing(): void
    {
        $household = Beneficiary::factory()->create();
        DispersalEvent::factory()->initial($household)->create(['date_dispersed' => '2026-09-01']);

        $this->artisan('ownership:backfill --dry-run')->assertSuccessful();

        $this->assertSame(0, Animal::withTrashed()->count());
        $this->assertSame(0, AnimalOwnershipEvent::count());
    }

    public function test_it_creates_one_animal_and_a_first_event_per_household(): void
    {
        $household = Beneficiary::factory()->create([
            'animal_type' => 'Swine (Pig)',
            'ear_tag_number' => 'TAG-BACKFILL-1',
            'sex' => 'F',
        ]);
        DispersalEvent::factory()->initial($household)->create(['date_dispersed' => '2026-09-01']);

        $this->artisan('ownership:backfill')->assertSuccessful();

        $animal = Animal::query()->where('legacy_beneficiary_id', $household->id)->firstOrFail();

        $this->assertSame($household->id, $animal->current_owner_id);
        $this->assertSame('TAG-BACKFILL-1', $animal->ear_tag_number);
        $this->assertSame('F', $animal->sex);

        $this->assertDatabaseHas('animal_ownership_events', [
            'animal_id' => $animal->id,
            'event_type' => 'dispersal',
            'from_beneficiary_id' => null,
            'to_beneficiary_id' => $household->id,
            'date_is_estimated' => false,
        ]);
    }

    public function test_a_missing_dispersal_date_is_marked_estimated(): void
    {
        $household = Beneficiary::factory()->create();
        // An old row whose date was never captured.
        DispersalEvent::factory()->initial($household)->create(['date_dispersed' => null]);

        $this->artisan('ownership:backfill')->assertSuccessful();

        $this->assertDatabaseHas('animal_ownership_events', [
            'to_beneficiary_id' => $household->id,
            'date_is_estimated' => true,
        ]);
    }

    public function test_legacy_re_dispersals_become_pass_on_events_linked_to_the_parent_animal(): void
    {
        $parentHousehold = Beneficiary::factory()->create();
        $recipient = Beneficiary::factory()->create();

        DispersalEvent::factory()->initial($parentHousehold)->create(['date_dispersed' => '2026-08-01']);
        DispersalEvent::factory()->reDispersal($recipient, $parentHousehold)->create(['date_dispersed' => '2026-09-01']);

        $this->artisan('ownership:backfill')->assertSuccessful();

        $parentAnimal = Animal::query()->where('legacy_beneficiary_id', $parentHousehold->id)->firstOrFail();
        $offspringAnimal = Animal::query()->where('legacy_beneficiary_id', $recipient->id)->firstOrFail();

        $this->assertSame($parentAnimal->id, $offspringAnimal->parent_animal_id);
        $this->assertSame($recipient->id, $offspringAnimal->current_owner_id);

        $this->assertDatabaseHas('animal_ownership_events', [
            'animal_id' => $offspringAnimal->id,
            'event_type' => 'pass_on',
            'from_beneficiary_id' => $parentHousehold->id,
            'to_beneficiary_id' => $recipient->id,
        ]);
    }

    public function test_re_running_migrates_nothing_and_keeps_the_chain_healthy(): void
    {
        $household = Beneficiary::factory()->create();
        DispersalEvent::factory()->initial($household)->create(['date_dispersed' => '2026-09-01']);

        $this->artisan('ownership:backfill')->assertSuccessful();

        $animalCount = Animal::withTrashed()->count();
        $eventCount = AnimalOwnershipEvent::count();

        // A second run must be a no-op.
        $this->artisan('ownership:backfill')->assertSuccessful();

        $this->assertSame($animalCount, Animal::withTrashed()->count());
        $this->assertSame($eventCount, AnimalOwnershipEvent::count());

        $this->artisan('ownership:verify')->assertSuccessful();
    }
}
