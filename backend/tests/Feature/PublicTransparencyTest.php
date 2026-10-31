<?php

namespace Tests\Feature;

use App\Models\Animal;
use App\Models\AnimalType;
use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The public transparency dashboard: aggregate-only numbers that AGREE with
 * the admin analytics (same events, same definitions), voided rows excluded,
 * no identities anywhere in the payload, cached between requests, and a
 * stable shape.
 */
class PublicTransparencyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\BarangaySeeder::class);
    }

    /* ------------------------------------------------------------------ *
     |  Helpers                                                            |
     * ------------------------------------------------------------------ */

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function animalTypeId(): int
    {
        return AnimalType::query()->where('name', 'Swine (Pig)')->firstOrFail()->id;
    }

    /** A household explicitly registered in one barangay — the snapshots the
     *  dispersal service writes come from this. */
    private function beneficiaryIn(string $barangayName, array $extra = []): object
    {
        $barangay = \App\Models\Barangay::query()->where('name', $barangayName)->firstOrFail();

        return Beneficiary::factory()->create([
            'address' => $barangayName,
            'barangay_id' => $barangay->id,
            ...$extra,
        ]);
    }

    private function disperse(User $actor, object $owner, ?string $date = null, ?string $tag = null): Animal
    {
        $response = $this->actingAs($actor)->postJson('/api/v1/dispersals', [
            'to_beneficiary_id' => $owner->id,
            'animal_type_id' => $this->animalTypeId(),
            'ear_tag_number' => $tag,
            'event_date' => $date ?? now()->toDateString(),
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

    private function redisperse(User $actor, int $animalId, object $to, ?string $date = null): void
    {
        $this->actingAs($actor)->postJson("/api/v1/animals/{$animalId}/redispersals", [
            'to_beneficiary_id' => $to->id,
            'base_event_id' => $this->latestEventId($animalId),
            'event_date' => $date ?? now()->toDateString(),
        ])->assertCreated();
    }

    private function transparency(): array
    {
        return $this->getJson('/api/v1/public/transparency')
            ->assertOk()
            ->json('data');
    }

    private function adminAnalytics(User $admin): array
    {
        return $this->actingAs($admin)
            ->getJson('/api/v1/analytics/barangay-dispersal')
            ->assertOk()
            ->json('data');
    }

    /* ------------------------------------------------------------------ *
     |  Access & shape                                                     |
     * ------------------------------------------------------------------ */

    public function test_transparency_is_public(): void
    {
        // No actingAs: the dashboard has no session.
        $this->getJson('/api/v1/public/transparency')->assertOk();
    }

    public function test_transparency_shape_is_stable(): void
    {
        $admin = $this->admin();
        $this->disperse($admin, $this->beneficiaryIn('Tayawan'), null, 'T1');

        $this->getJson('/api/v1/public/transparency')
            ->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'totals' => ['animals_dispersed', 'barangays_covered', 're_dispersals', 'households'],
                    'per_barangay' => [['name', 'animals_dispersed', 're_dispersals']],
                    'reach_over_time' => [['month', 'animals_dispersed']],
                    'vaccination' => ['compliant', 'total', 'rate'],
                    'generated_at',
                ],
            ]);
    }

    /* ------------------------------------------------------------------ *
     |  The numbers agree with the admin analytics                         |
     * ------------------------------------------------------------------ */

    public function test_public_totals_equal_the_admin_analytics_totals(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiaryIn('Tayawan');
        $other = $this->beneficiaryIn('Dawis');

        $this->disperse($admin, $owner, null, 'T1');
        $this->disperse($admin, $owner, null, 'T2');
        $animal = $this->disperse($admin, $other, null, 'T3');
        $this->redisperse($admin, $animal->id, $owner);

        $public = $this->transparency();
        $analytics = $this->adminAnalytics($admin);

        // The public "animals dispersed" IS the admin tab's city Dispersed total.
        $this->assertSame(
            $analytics['summary']['dispersed']['total'],
            $public['totals']['animals_dispersed'],
        );
        // Re-dispersals (out) likewise.
        $this->assertSame(
            $analytics['summary']['redispersed_out']['total'],
            $public['totals']['re_dispersals'],
        );
        // The barangay rows carry the same per-barangay numbers.
        $adminRows = collect($analytics['barangays'])
            ->filter(fn (array $row): bool => $row['dispersed'] > 0 || $row['redispersed_out'] > 0)
            ->sortByDesc('dispersed')
            ->values();
        $publicRows = collect($public['per_barangay']);

        $this->assertSame($adminRows->count(), $publicRows->count());
        $this->assertSame(
            $adminRows->pluck('name')->all(),
            $publicRows->pluck('name')->all(),
        );
        foreach ($adminRows as $index => $row) {
            $this->assertSame($row['dispersed'], $publicRows[$index]['animals_dispersed']);
            $this->assertSame($row['redispersed_out'], $publicRows[$index]['re_dispersals']);
        }
    }

    public function test_voided_events_are_excluded(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiaryIn('Tayawan');

        $kept = $this->disperse($admin, $owner, null, 'T1');
        $voided = $this->disperse($admin, $owner, null, 'T2');

        $this->actingAs($admin)->postJson("/api/v1/ownership-events/{$this->latestEventId($voided->id)}/void", [
            'void_reason' => 'recorded in error',
        ])->assertOk();

        $public = $this->transparency();

        // Only the kept dispersal survives in every public number.
        $this->assertSame(1, $public['totals']['animals_dispersed']);
        $rows = collect($public['per_barangay'])->first();
        $this->assertSame(1, $rows['animals_dispersed']);

        // And the admin analytics agrees — the two views cannot drift.
        $this->assertSame(1, $this->adminAnalytics($admin)['summary']['dispersed']['total']);
    }

    /* ------------------------------------------------------------------ *
     |  Definitions                                                        |
     * ------------------------------------------------------------------ */

    public function test_animals_dispersed_counts_animals_and_households_is_separate(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiaryIn('Tayawan');

        // THREE animals, ONE household: animals_dispersed counts animals.
        $this->disperse($admin, $owner, null, 'T1');
        $this->disperse($admin, $owner, null, 'T2');
        $this->disperse($admin, $owner, null, 'T3');

        $public = $this->transparency();

        $this->assertSame(3, $public['totals']['animals_dispersed']);
        $this->assertSame(1, $public['totals']['households']);
        $this->assertSame(1, $public['totals']['barangays_covered']);
    }

    public function test_re_dispersals_are_credited_to_the_source_barangay(): void
    {
        $admin = $this->admin();
        $first = $this->beneficiaryIn('Dawis');
        $second = $this->beneficiaryIn('Tayawan');

        $animal = $this->disperse($admin, $first, null, 'T1');
        $this->redisperse($admin, $animal->id, $second);

        $rows = collect($this->transparency()['per_barangay'])->keyBy('name');

        // Re-dispersed OUT of Dawis (the source), matching the admin tab.
        $this->assertSame(1, $rows->get('Dawis')['re_dispersals']);
        // Barangays with no recorded events do not appear: Tayawan received
        // the animal but nothing was re-dispersed OUT of it.
        $this->assertNull($rows->get('Tayawan'));
    }

    /* ------------------------------------------------------------------ *
     |  Reach series                                                       |
     * ------------------------------------------------------------------ */

    public function test_reach_over_time_is_a_full_zero_filled_series(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiaryIn('Dawis');

        $this->disperse($admin, $owner, null, 'T1');
        $this->disperse($admin, $owner, null, 'T2');

        $series = $this->transparency()['reach_over_time'];

        // Always twelve buckets, oldest first, so a chart shows gaps as gaps.
        $this->assertCount(12, $series);
        $this->assertSame(now()->format('Y-m'), $series[11]['month']);
        $this->assertSame(2, $series[11]['animals_dispersed']);

        foreach ($series as $bucket) {
            $this->assertArrayHasKey('month', $bucket);
            $this->assertArrayHasKey('animals_dispersed', $bucket);
        }
    }

    /* ------------------------------------------------------------------ *
     |  Privacy                                                            |
     * ------------------------------------------------------------------ */

    /** The whole point of the aggregate endpoint: no identities escape. */
    public function test_transparency_leaks_no_beneficiary_identity(): void
    {
        $admin = $this->admin();
        $technician = User::factory()->create(['role' => 'technician', 'name' => 'Tech Rey']);

        $owner = Beneficiary::factory()
            ->assignedTo($technician)
            ->create([
                'name_of_farmer' => 'Darna Villanueva',
                'address' => 'Dawis',
                'latitude' => 9.47123,
                'longitude' => 122.83191,
            ]);

        MonitoringRecord::factory()->by($technician)->create([
            'beneficiary_id' => $owner->id,
        ]);
        $this->disperse($admin, $owner, null, 'T1');

        $json = $this->getJson('/api/v1/public/transparency')
            ->assertOk()
            ->json();

        $body = json_encode($json);

        // No beneficiary/technician names, no per-farm coordinates, no ids,
        // no technician key anywhere in the payload.
        $this->assertStringNotContainsString('Darna Villanueva', $body);
        $this->assertStringNotContainsString('Tech Rey', $body);
        $this->assertStringNotContainsString('9.47123', $body);
        $this->assertStringNotContainsString('122.83191', $body);
        $this->assertStringNotContainsString('name_of_farmer', $body);
        $this->assertStringNotContainsString('technician', $body);
    }

    /* ------------------------------------------------------------------ *
     |  Cache                                                              |
     * ------------------------------------------------------------------ */

    public function test_transparency_is_cached_between_requests(): void
    {
        $admin = $this->admin();
        $owner = $this->beneficiaryIn('Dawis');
        $this->disperse($admin, $owner, null, 'T1');

        $first = $this->getJson('/api/v1/public/transparency')->assertOk()->json();

        // A row inserted after the first read is invisible until the cache
        // expires — anonymous traffic must not become a query amplifier.
        $this->disperse($admin, $owner, null, 'T2');

        $second = $this->getJson('/api/v1/public/transparency')->assertOk()->json();

        $this->assertSame(
            $first['data']['totals']['animals_dispersed'],
            $second['data']['totals']['animals_dispersed'],
        );
    }

    /* ------------------------------------------------------------------ *
     |  Vaccination (unchanged source, still asserted)                     |
     * ------------------------------------------------------------------ */

    public function test_transparency_reports_vaccination_compliance(): void
    {
        $now = now()->startOfDay();

        // Two animals current with the 180-day cycle: compliant.
        foreach ([10, 100] as $daysAgo) {
            $beneficiary = Beneficiary::factory()->create();
            MonitoringRecord::factory()->for($beneficiary)->create([
                'vaccination_date' => $now->copy()->subDays($daysAgo),
            ]);
        }

        // Overdue: last shot older than the interval.
        $overdue = Beneficiary::factory()->create();
        MonitoringRecord::factory()->for($overdue)->create([
            'vaccination_date' => $now->copy()->subDays(200),
        ]);

        // Never vaccinated: also not compliant.
        Beneficiary::factory()->create();

        $this->getJson('/api/v1/public/transparency')
            ->assertOk()
            ->assertJsonPath('data.vaccination.compliant', 2)
            ->assertJsonPath('data.vaccination.total', 4)
            ->assertJsonPath('data.vaccination.rate', 0.5);
    }

    public function test_vaccination_rate_is_null_when_there_are_no_animals(): void
    {
        $this->getJson('/api/v1/public/transparency')
            ->assertOk()
            ->assertJsonPath('data.vaccination.total', 0)
            ->assertJsonPath('data.vaccination.rate', null);
    }
}
