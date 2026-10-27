<?php

namespace Tests\Feature;

use App\Models\Animal;
use App\Models\AnimalType;
use App\Models\Beneficiary;
use App\Models\User;
use App\Services\AnimalDispersalService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * `ownership:verify` — the invariant check (each event's `from` equals the
 * previous event's `to`; `current_owner_id` equals the last event's `to`).
 * Reports, never repairs.
 */
class OwnershipVerifyTest extends TestCase
{
    use RefreshDatabase;

    private function chain(): Animal
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $type = AnimalType::query()->where('name', 'Swine (Pig)')->firstOrFail();
        $a = Beneficiary::factory()->create();
        $b = Beneficiary::factory()->create();

        $created = $this->actingAs($admin)->postJson('/api/v1/dispersals', [
            'to_beneficiary_id' => $a->id,
            'animal_type_id' => $type->id,
            'ear_tag_number' => 'TAG-VERIFY',
        ])->assertCreated();

        $animalId = $created->json('data.animal_id');
        $base = (int) DB::table('animal_ownership_events')->where('animal_id', $animalId)->value('id');

        $this->actingAs($admin)->postJson("/api/v1/animals/{$animalId}/redispersals", [
            'to_beneficiary_id' => $b->id,
            'base_event_id' => $base,
        ])->assertCreated();

        return Animal::findOrFail($animalId);
    }

    public function test_a_healthy_chain_reports_no_problems(): void
    {
        $animal = $this->chain();

        $report = app(AnimalDispersalService::class)->verifyChain();

        $this->assertSame([], $report['breaks']);
        $this->assertSame(1, $report['animals_checked']);
        $this->assertSame(2, $report['events_checked']);

        $this->artisan('ownership:verify')->assertSuccessful();

        unset($animal);
    }

    public function test_a_drifted_current_owner_is_reported_and_the_command_fails(): void
    {
        $animal = $this->chain();

        // Bypass the service to simulate a hand-edited/half-written row.
        DB::table('animals')->where('id', $animal->id)->update(['current_owner_id' => null]);

        $report = app(AnimalDispersalService::class)->verifyChain();

        $this->assertNotEmpty($report['breaks']);
        $this->assertSame('current_owner_mismatch', $report['breaks'][0]['type']);

        $this->artisan('ownership:verify')->assertFailed();
    }

    public function test_a_broken_from_link_is_reported(): void
    {
        $animal = $this->chain();

        $wrongOwner = Beneficiary::factory()->create();

        // Corrupt the second event's `from` so it no longer matches the first
        // event's `to`.
        DB::table('animal_ownership_events')
            ->where('animal_id', $animal->id)
            ->where('event_type', 're_dispersal')
            ->update(['from_beneficiary_id' => $wrongOwner->id]);

        $report = app(AnimalDispersalService::class)->verifyChain();

        $this->assertContains('from_mismatch', array_column($report['breaks'], 'type'));

        $this->artisan('ownership:verify')->assertFailed();
    }
}
