<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PublicTransparencyTest extends TestCase
{
    use RefreshDatabase;

    public function test_transparency_is_public(): void
    {
        // Three DISTINCT barangays on purpose: the factory draws a random
        // covered barangay per row, and this assertion counts the emitted
        // groups — three random draws collide often enough (birthday problem
        // over 28 barangays) to make the test intermittently red.
        Beneficiary::factory()->create(['address' => 'Dawis']);
        Beneficiary::factory()->create(['address' => 'Tayawan']);
        Beneficiary::factory()->create(['address' => 'Nangka']);

        // No actingAs: the dashboard has no session.
        $this->getJson('/api/v1/public/transparency')
            ->assertOk()
            ->assertJsonCount(3, 'data.per_barangay')
            ->assertJsonPath('data.totals.beneficiaries', 3);
    }

    public function test_transparency_counts_beneficiaries_and_re_dispersals_per_barangay(): void
    {
        $parent = Beneficiary::factory()->create(['address' => 'Dawis']);
        $recipient = Beneficiary::factory()->create(['address' => 'Tayawan']);

        // A pass-on is credited to the SOURCE household's barangay.
        DispersalEvent::factory()->reDispersal($recipient, $parent)->create();
        DispersalEvent::factory()->initial($parent)->create();

        $response = $this->getJson('/api/v1/public/transparency')->assertOk();

        $rows = collect($response->json('data.per_barangay'))->keyBy('name');

        $this->assertSame(1, $rows->get('Dawis')['beneficiaries']);
        $this->assertSame(1, $rows->get('Dawis')['re_dispersals']);
        $this->assertSame(1, $rows->get('Tayawan')['beneficiaries']);
        $this->assertSame(0, $rows->get('Tayawan')['re_dispersals']);

        $this->assertSame(1, $response->json('data.totals.re_dispersals'));

        // Busiest barangay first (a stable order for the table).
        $counts = array_column($response->json('data.per_barangay'), 'beneficiaries');
        $sorted = $counts;
        rsort($sorted);
        $this->assertSame($sorted, $counts);
    }

    public function test_reach_over_time_is_a_full_zero_filled_series(): void
    {
        Beneficiary::factory()->count(2)->create(['address' => 'Dawis']);

        DispersalEvent::factory()->initial(Beneficiary::first())->create([
            'date_dispersed' => now()->toDateString(),
        ]);

        $series = $this->getJson('/api/v1/public/transparency')
            ->assertOk()
            ->json('data.reach_over_time');

        // Always twelve buckets, oldest first, so a chart shows gaps as gaps.
        $this->assertCount(12, $series);

        $this->assertSame(now()->format('Y-m'), $series[11]['month']);
        $this->assertSame(2, $series[11]['beneficiaries']);
        $this->assertSame(1, $series[11]['dispersals']);

        foreach ($series as $bucket) {
            $this->assertArrayHasKey('month', $bucket);
            $this->assertArrayHasKey('beneficiaries', $bucket);
            $this->assertArrayHasKey('dispersals', $bucket);
        }
    }

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

    /** The whole point of the aggregate endpoint: no identities escape. */
    public function test_transparency_leaks_no_beneficiary_identity(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer', 'name' => 'Darna Villanueva']);
        $technician = User::factory()->create(['role' => 'technician', 'name' => 'Tech Rey']);

        $beneficiary = Beneficiary::factory()
            ->forFarmer($farmer)
            ->assignedTo($technician)
            ->create([
                'name_of_farmer' => 'Darna Villanueva',
                'address' => 'Dawis',
                'latitude' => 9.47123,
                'longitude' => 122.83191,
            ]);

        MonitoringRecord::factory()->by($technician)->create([
            'beneficiary_id' => $beneficiary->id,
        ]);
        DispersalEvent::factory()->initial($beneficiary)->create();

        $json = $this->getJson('/api/v1/public/transparency')
            ->assertOk()
            ->json();

        $body = json_encode($json);

        // No farmer/technician names, no per-farm coordinates, no ids, no
        // technician key anywhere in the payload.
        $this->assertStringNotContainsString('Darna Villanueva', $body);
        $this->assertStringNotContainsString('Tech Rey', $body);
        $this->assertStringNotContainsString('9.47123', $body);
        $this->assertStringNotContainsString('122.83191', $body);
        $this->assertStringNotContainsString('name_of_farmer', $body);
        $this->assertStringNotContainsString('technician', $body);
    }

    public function test_transparency_is_cached_between_requests(): void
    {
        Beneficiary::factory()->count(2)->create();

        $first = $this->getJson('/api/v1/public/transparency')->assertOk()->json();

        // A row inserted after the first read is invisible until the cache
        // expires — anonymous traffic must not become a query amplifier.
        Beneficiary::factory()->create();

        $second = $this->getJson('/api/v1/public/transparency')->assertOk()->json();

        $this->assertSame(
            $first['data']['totals']['beneficiaries'],
            $second['data']['totals']['beneficiaries'],
        );
    }

    /**
     * The summary shape is a public API contract — a rename here silently
     * blanks the transparency dashboard, so pin it down.
     */
    public function test_transparency_shape_is_stable(): void
    {
        Beneficiary::factory()->create(['address' => 'Dawis']);

        $this->getJson('/api/v1/public/transparency')
            ->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'totals' => ['beneficiaries', 'barangays_covered', 're_dispersals'],
                    'per_barangay' => [['name', 'beneficiaries', 're_dispersals']],
                    'reach_over_time' => [['month', 'beneficiaries', 'dispersals']],
                    'vaccination' => ['compliant', 'total', 'rate'],
                    'generated_at',
                ],
            ]);
    }
}
