<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The farmer-name search on the monitoring table.
 *
 * Like the month filter, the search is a backend query parameter applied
 * BEFORE pagination: a match that sorts onto a later page is still found,
 * `meta.total` is the search's real count, and the role scoping still holds
 * (a technician cannot search their way to another technician's farmers).
 */
class MonitoringSearchTest extends TestCase
{
    use RefreshDatabase;

    private User $technician;

    private Beneficiary $beneficiary;

    protected function setUp(): void
    {
        parent::setUp();

        $this->technician = User::factory()->create(['role' => 'technician']);
        $this->beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create([
            'name_of_farmer' => 'Aling Nena',
        ]);
    }

    public function test_search_matches_a_partial_farmer_name_case_insensitively(): void
    {
        MonitoringRecord::factory()->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create(['date_monitored' => '2026-09-21']);

        $other = Beneficiary::factory()->assignedTo($this->technician)->create([
            'name_of_farmer' => 'Doyle Walter',
        ]);
        MonitoringRecord::factory()->by($this->technician)
            ->for($other, 'beneficiary')
            ->create(['date_monitored' => '2026-09-22']);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?search=neNA')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.name_of_farmer', 'Aling Nena');
    }

    public function test_search_combines_with_the_month_filter(): void
    {
        MonitoringRecord::factory()->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create(['date_monitored' => '2026-09-21']);
        MonitoringRecord::factory()->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create(['date_monitored' => '2026-08-05']);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?search=Nena&month=2026-08')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.date_monitored', '2026-08-05');
    }

    public function test_search_finds_a_match_that_sorts_onto_a_later_page(): void
    {
        // The matching farmer's visit is the OLDEST row, so it sorts last —
        // filtering the fetched page client-side would never have seen it.
        MonitoringRecord::factory()->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create(['date_monitored' => '2026-01-05']);

        $other = Beneficiary::factory()->assignedTo($this->technician)->create([
            'name_of_farmer' => 'Doyle Walter',
        ]);

        foreach (['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'] as $date) {
            MonitoringRecord::factory()->by($this->technician)
                ->for($other, 'beneficiary')
                ->create(['date_monitored' => $date]);
        }

        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?search=Nena&per_page=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.name_of_farmer', 'Aling Nena');
    }

    public function test_search_is_scoped_to_the_caller(): void
    {
        $other = User::factory()->create(['role' => 'technician']);
        $otherBeneficiary = Beneficiary::factory()->assignedTo($other)->create([
            'name_of_farmer' => 'Aling Nena',
        ]);
        MonitoringRecord::factory()->by($other)->for($otherBeneficiary, 'beneficiary')
            ->create(['date_monitored' => '2026-09-21']);

        // A technician never finds another technician's farmers — the search
        // cannot widen the existing scope.
        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?search=Nena')
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.total', 0);
    }

    public function test_search_rejects_an_overlong_term(): void
    {
        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?search='.str_repeat('a', 101))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['search']);
    }

    public function test_blank_search_is_ignored(): void
    {
        MonitoringRecord::factory()->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create(['date_monitored' => '2026-09-21']);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?search=')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }
}
