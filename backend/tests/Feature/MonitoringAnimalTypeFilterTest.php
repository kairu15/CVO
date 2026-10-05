<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The animal-type filter and the "group by type" sort on the monitoring list.
 *
 * Filtering/sorting must run in the DATABASE (WHERE/ORDER BY before
 * pagination), and the animal-type filter must combine with the month filter
 * with AND — never one overriding the other.
 */
class MonitoringAnimalTypeFilterTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
    }

    /** A household of one animal type with a single monitoring record. */
    private function household(string $name, string $type, string $date): void
    {
        $beneficiary = Beneficiary::factory()->create([
            'name_of_farmer' => $name,
            'animal_type' => $type,
        ]);

        MonitoringRecord::factory()->for($beneficiary, 'beneficiary')->create([
            'date_monitored' => $date,
        ]);
    }

    public function test_lists_only_the_selected_animal_type(): void
    {
        $this->household('Boar Farmer', 'Boar', '2025-12-05');
        $this->household('Cattle Farmer', 'Cattle', '2025-12-06');

        $response = $this->actingAs($this->admin)
            ->getJson('/api/v1/monitoring-records?per_page=100&animal_type=Boar')
            ->assertOk();

        $this->assertSame(
            ['Boar Farmer'],
            collect($response->json('data'))->pluck('name_of_farmer')->all(),
        );
        $response->assertJsonPath('meta.total', 1);
    }

    public function test_animal_type_and_month_filters_combine_with_and(): void
    {
        $this->household('Dec Boar', 'Boar', '2025-12-05');
        $this->household('Nov Boar', 'Boar', '2025-11-05');
        $this->household('Dec Cattle', 'Cattle', '2025-12-06');

        $response = $this->actingAs($this->admin)
            ->getJson('/api/v1/monitoring-records?per_page=100&animal_type=Boar&month=2025-12')
            ->assertOk();

        $this->assertSame(
            ['Dec Boar'],
            collect($response->json('data'))->pluck('name_of_farmer')->all(),
        );
        $response->assertJsonPath('meta.total', 1);
    }

    public function test_animal_type_options_come_from_the_data_sorted(): void
    {
        $this->household('A', 'Goat', '2025-12-01');
        $this->household('B', 'Boar', '2025-12-02');
        $this->household('C', 'Carabao', '2025-12-03');
        $this->household('D', 'Boar', '2025-12-04'); // duplicate type — must not repeat

        $this->actingAs($this->admin)
            ->getJson('/api/v1/monitoring-records/animal-types')
            ->assertOk()
            ->assertJsonPath('data', ['Boar', 'Carabao', 'Goat']);
    }

    public function test_sort_by_animal_type_orders_rows_alphabetically(): void
    {
        $this->household('Zed', 'Goat', '2025-12-01');
        $this->household('Amy', 'Boar', '2025-12-02');
        $this->household('Bob', 'Boar', '2025-12-03');
        $this->household('Cat', 'Carabao', '2025-12-04');

        $response = $this->actingAs($this->admin)
            ->getJson('/api/v1/monitoring-records?per_page=100&sort=animal_type')
            ->assertOk();

        $records = collect($response->json('data'));

        // Groups run alphabetically…
        $this->assertSame(
            ['Boar', 'Boar', 'Carabao', 'Goat'],
            $records->pluck('animal_type')->all(),
        );

        // …and the existing secondary order (newest visit first) still holds
        // WITHIN a group.
        $this->assertSame(
            ['Bob', 'Amy'],
            $records->where('animal_type', 'Boar')->pluck('name_of_farmer')->values()->all(),
        );
    }

    public function test_the_default_sort_is_not_animal_type(): void
    {
        $this->household('Zed', 'Goat', '2025-12-01');
        $this->household('Amy', 'Boar', '2025-12-03');

        $response = $this->actingAs($this->admin)
            ->getJson('/api/v1/monitoring-records?per_page=100')
            ->assertOk();

        // Newest first (Amy on Dec 3, Zed on Dec 1) — the pre-existing order,
        // unchanged when sort is omitted.
        $this->assertSame(
            ['Amy', 'Zed'],
            collect($response->json('data'))->pluck('name_of_farmer')->all(),
        );
    }
}
