<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The monitoring table as an oversight tool: the KPI strip, the barangay and
 * "needs attention" worklists, search beyond the farmer's name, sortable
 * headers, and TRUE per-group counts.
 */
class MonitoringDirectoryTest extends TestCase
{
    use RefreshDatabase;

    private function recordFor(Beneficiary $beneficiary, User $technician, ?string $date): MonitoringRecord
    {
        return MonitoringRecord::factory()
            ->by($technician)
            ->for($beneficiary, 'beneficiary')
            ->create(['date_monitored' => $date]);
    }

    public function test_the_summary_reports_the_oversight_figures_in_one_request(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);

        $monitored = Beneficiary::factory()->assignedTo($technician)->create(['moa_signed' => true]);
        $this->recordFor($monitored, $technician, now()->toDateString());

        $unsigned = Beneficiary::factory()->assignedTo($technician)->create(['moa_signed' => null]);
        $this->recordFor($unsigned, $technician, now()->toDateString());

        // Assigned, but the enrolment row carries no date — the never-visited
        // roster the page exists to surface.
        $never = Beneficiary::factory()->assignedTo($technician)->create();
        $this->recordFor($never, $technician, null);

        $this->actingAs($admin)
            ->getJson('/api/v1/monitoring-records/summary')
            ->assertOk()
            ->assertJsonPath('data.households_monitored', 2)
            ->assertJsonPath('data.visits', 2)
            ->assertJsonPath('data.never_visited', 1)
            ->assertJsonPath('data.without_photo', 2)
            ->assertJsonPath('data.moa_unsigned', 1)
            ->assertJsonPath('data.overdue_days', 60)
            ->assertJsonPath('data.month', now()->format('Y-m'));
    }

    public function test_the_barangay_filter_and_group_totals_cover_the_whole_filtered_set(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);

        $dawis = Beneficiary::factory()->assignedTo($technician)->count(2)->create(['address' => 'Dawis']);
        $other = Beneficiary::factory()->assignedTo($technician)->create(['address' => 'Banay Banay']);

        foreach ($dawis as $beneficiary) {
            $this->recordFor($beneficiary, $technician, '2026-09-10');
        }
        $this->recordFor($other, $technician, '2026-09-11');

        $this->actingAs($admin)
            ->getJson('/api/v1/monitoring-records?barangay=Dawis&group_by=address&per_page=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total', 2)
            // One row is on the page; the header still reports both.
            ->assertJsonPath('group_totals.Dawis', 2)
            ->assertJsonPath('group_totals.Banay Banay', null);
    }

    public function test_attention_filters_separate_never_visited_from_stale_visits(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);

        $never = Beneficiary::factory()->assignedTo($technician)->create();
        $this->recordFor($never, $technician, null);

        $stale = Beneficiary::factory()->assignedTo($technician)->create();
        $this->recordFor($stale, $technician, now()->subDays(120)->toDateString());

        $fresh = Beneficiary::factory()->assignedTo($technician)->create();
        $this->recordFor($fresh, $technician, now()->toDateString());

        $this->actingAs($admin)
            ->getJson('/api/v1/monitoring-records?attention=never')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $never->monitoringRecords()->first()->id);

        $this->actingAs($admin)
            ->getJson('/api/v1/monitoring-records?attention=30')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name_of_farmer', $stale->name_of_farmer);
    }

    public function test_search_matches_rsbsa_ear_tag_and_the_assigned_technician(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician', 'name' => 'Jun Bisaya']);

        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create([
            'name_of_farmer' => 'Nena Reyes',
            'rsbsa_number' => 'RSBSA-777',
            'ear_tag_number' => 'TAG-9',
        ]);
        $this->recordFor($beneficiary, $technician, '2026-09-10');

        // Unassigned, so the technician-name search has exactly one match.
        $other = Beneficiary::factory()->create(['name_of_farmer' => 'Other Farmer']);
        $this->recordFor($other, $technician, '2026-09-11');

        foreach (['RSBSA-777', 'TAG-9', 'Jun Bisaya'] as $term) {
            $this->actingAs($admin)
                ->getJson('/api/v1/monitoring-records?search='.urlencode($term))
                ->assertOk()
                ->assertJsonCount(1, 'data')
                ->assertJsonPath('data.0.name_of_farmer', 'Nena Reyes');
        }
    }

    public function test_headers_sort_server_side_in_both_directions(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);

        $b = Beneficiary::factory()->assignedTo($technician)->create(['name_of_farmer' => 'B Farmer']);
        $a = Beneficiary::factory()->assignedTo($technician)->create(['name_of_farmer' => 'A Farmer']);
        $this->recordFor($b, $technician, '2026-09-10');
        $this->recordFor($a, $technician, '2026-09-11');

        $this->actingAs($admin)
            ->getJson('/api/v1/monitoring-records?sort=name&direction=asc')
            ->assertOk()
            ->assertJsonPath('data.0.name_of_farmer', 'A Farmer');

        $this->actingAs($admin)
            ->getJson('/api/v1/monitoring-records?sort=name&direction=desc')
            ->assertOk()
            ->assertJsonPath('data.0.name_of_farmer', 'B Farmer');

        $this->actingAs($admin)
            ->getJson('/api/v1/monitoring-records?sort=date&direction=asc')
            ->assertOk()
            ->assertJsonPath('data.0.name_of_farmer', 'B Farmer');
    }

    public function test_the_page_size_defaults_to_fifty_and_is_capped_there(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);

        Beneficiary::factory()->assignedTo($technician)->count(60)->create()
            ->each(fn (Beneficiary $beneficiary) => $this->recordFor($beneficiary, $technician, '2026-09-10'));

        $this->actingAs($admin)
            ->getJson('/api/v1/monitoring-records?per_page=200')
            ->assertOk()
            ->assertJsonCount(50, 'data')
            ->assertJsonPath('meta.per_page', 50)
            ->assertJsonPath('meta.total', 60);
    }
}
