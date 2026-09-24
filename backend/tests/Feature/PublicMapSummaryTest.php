<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\MonitoringRecord;
use App\Models\User;
use Database\Factories\BeneficiaryFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PublicMapSummaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_summary_is_public(): void
    {
        Beneficiary::factory()->count(3)->create();

        // No actingAs: the landing page has no session.
        $this->getJson('/api/v1/public/map-summary')
            ->assertOk()
            ->assertJsonCount(3, 'data.barangays')
            ->assertJsonPath('data.totals.beneficiaries', 3);
    }

    public function test_summary_counts_per_barangay_with_centroids(): void
    {
        Beneficiary::factory()->count(2)->create(['address' => 'Dawis']);
        Beneficiary::factory()->create(['address' => 'Banay Banay']);
        Beneficiary::factory()->create(['address' => 'Banay Banay', 'latitude' => null, 'longitude' => null]);

        $response = $this->getJson('/api/v1/public/map-summary')
            ->assertOk();

        $barangays = collect($response->json('data.barangays'))->keyBy('name');

        // Counts are per barangay, geo-tagged or not — the map shows program
        // coverage, not coordinate completeness.
        $this->assertSame(2, $barangays->get('Dawis')['count']);
        $this->assertSame(2, $barangays->get('Banay Banay')['count']);

        // Pins sit on the fixed centroids, rounded to ~110 m.
        $this->assertSame(9.471, $barangays->get('Dawis')['lat']);
        $this->assertSame(122.832, $barangays->get('Dawis')['lng']);

        // Only barangays with rows appear.
        $this->assertNull($barangays->get('Tayawan'));

        // Totals count every beneficiary; geo_tagged excludes null coords.
        $this->assertSame(4, $response->json('data.totals.beneficiaries'));
        $this->assertSame(3, $response->json('data.totals.geo_tagged'));
    }

    public function test_summary_counts_re_dispersals(): void
    {
        $parent = Beneficiary::factory()->create();
        $recipient = Beneficiary::factory()->create();

        DispersalEvent::factory()->reDispersal($recipient, $parent)->create();
        DispersalEvent::factory()->initial($parent)->create();

        $this->getJson('/api/v1/public/map-summary')
            ->assertOk()
            ->assertJsonPath('data.totals.re_dispersals', 1);
    }

    public function test_summary_counts_vaccinations_due_like_the_schedule(): void
    {
        $now = now()->startOfDay();

        // Overdue: last shot older than the 180-day interval.
        $overdue = Beneficiary::factory()->create();
        MonitoringRecord::factory()->for($overdue)->create([
            'vaccination_date' => $now->copy()->subDays(200),
        ]);

        // Due soon: inside the 30-day window before the interval ends.
        $dueSoon = Beneficiary::factory()->create();
        MonitoringRecord::factory()->for($dueSoon)->create([
            'vaccination_date' => $now->copy()->subDays(170),
        ]);

        // Scheduled: comfortably outside the window.
        $scheduled = Beneficiary::factory()->create();
        MonitoringRecord::factory()->for($scheduled)->create([
            'vaccination_date' => $now->copy()->subDays(10),
        ]);

        // Never vaccinated.
        Beneficiary::factory()->create();

        $this->getJson('/api/v1/public/map-summary')
            ->assertOk()
            ->assertJsonPath('data.totals.vaccinations_due', 3);
    }

    /** The whole point of the aggregate endpoint: no identities escape. */
    public function test_summary_leaks_no_beneficiary_identity(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer', 'name' => 'Darna Villanueva']);
        $technician = User::factory()->create(['role' => 'technician', 'name' => 'Tech Rey']);

        Beneficiary::factory()
            ->forFarmer($farmer)
            ->assignedTo($technician)
            ->create([
                'name_of_farmer' => 'Darna Villanueva',
                'latitude' => 9.47123,
                'longitude' => 122.83191,
            ]);

        MonitoringRecord::factory()->by($technician)->create([
            'beneficiary_id' => Beneficiary::first()->id,
        ]);

        $json = $this->getJson('/api/v1/public/map-summary')
            ->assertOk()
            ->json();

        $body = json_encode($json);

        // No farmer/technician names, no per-farm coordinates, no ids.
        $this->assertStringNotContainsString('Darna Villanueva', $body);
        $this->assertStringNotContainsString('Tech Rey', $body);
        $this->assertStringNotContainsString('9.47123', $body);
        $this->assertStringNotContainsString('122.83191', $body);
        $this->assertStringNotContainsString('name_of_farmer', $body);
        $this->assertStringNotContainsString('technician', $body);
    }

    public function test_summary_is_cached_between_requests(): void
    {
        Beneficiary::factory()->count(2)->create();

        $first = $this->getJson('/api/v1/public/map-summary')->assertOk()->json();

        // A row inserted after the first read is invisible until the cache
        // expires — anonymous traffic must not become a query amplifier.
        Beneficiary::factory()->create();

        $second = $this->getJson('/api/v1/public/map-summary')->assertOk()->json();

        $this->assertSame(
            $first['data']['totals']['beneficiaries'],
            $second['data']['totals']['beneficiaries'],
        );
    }

    public function test_summary_center_falls_back_to_bayawan_city(): void
    {
        $this->getJson('/api/v1/public/map-summary')
            ->assertOk()
            ->assertJsonPath('data.center.lat', 9.3638)
            ->assertJsonPath('data.center.lng', 122.8022)
            ->assertJsonCount(0, 'data.barangays');
    }

    /**
     * The summary shape is a public API contract — a rename here silently
     * blanks the landing map, so pin it down.
     */
    public function test_summary_shape_is_stable(): void
    {
        Beneficiary::factory()->create(['address' => 'Dawis']);

        $this->getJson('/api/v1/public/map-summary')
            ->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'barangays' => [['name', 'lat', 'lng', 'count']],
                    'totals' => ['beneficiaries', 'geo_tagged', 're_dispersals', 'vaccinations_due'],
                    'center',
                    'generated_at',
                ],
            ]);
    }
}
