<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The five chart aggregations behind the Reports screen.
 *
 * Each chart is its own endpoint and its own aggregation. The assertions pin
 * the two things a chart must get right: the NUMBERS (grouped in the
 * database, zero-filled so gaps read as zero) and the FILTERS (the same
 * barangay / animal-type / month / date-range filters the rest of the system
 * already speaks).
 */
class ReportChartTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
    }

    private function chart(string $name, array $query = []): array
    {
        return $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/report/charts/'.$name.(empty($query) ? '' : '?'.http_build_query($query)))
            ->assertOk()
            ->json('data');
    }

    public function test_a_guest_and_non_holders_cannot_read_charts(): void
    {
        $this->getJson('/api/v1/admin/report/charts/dispersal-trend')->assertUnauthorized();

        foreach (['doctor', 'technician', 'farmer'] as $role) {
            $this->actingAs(User::factory()->create(['role' => $role]))
                ->getJson('/api/v1/admin/report/charts/dispersal-trend')
                ->assertForbidden();
        }
    }

    public function test_dispersal_trend_buckets_months_and_zero_fills(): void
    {
        $beneficiary = Beneficiary::factory()->create(['address' => 'Dawis']);

        DispersalEvent::factory()->initial($beneficiary)
            ->create(['date_dispersed' => now()->startOfMonth()->toDateString()]);
        DispersalEvent::factory()->initial($beneficiary)
            ->create(['date_dispersed' => now()->subMonths(2)->startOfMonth()->toDateString()]);
        DispersalEvent::factory()->reDispersal($beneficiary, $beneficiary)
            ->create(['date_dispersed' => now()->subMonths(2)->toDateString()]);

        $data = $this->chart('dispersal-trend');

        // Trailing 12 months, oldest first, months without dispersals zeroed.
        $this->assertCount(12, $data);
        $this->assertSame(now()->subMonths(11)->format('Y-m'), $data[0]['month']);

        $current = $data[11];
        $this->assertSame(now()->format('Y-m'), $current['month']);
        $this->assertSame(1, $current['dispersals']);
        $this->assertSame(0, $current['re_dispersals']);

        $twoMonthsAgo = $data[9];
        $this->assertSame(2, $twoMonthsAgo['dispersals']);
        $this->assertSame(1, $twoMonthsAgo['re_dispersals']);

        // A quiet month is a zero, not a missing row.
        $this->assertSame(0, $data[5]['dispersals']);
    }

    public function test_dispersal_trend_respects_a_date_range(): void
    {
        $beneficiary = Beneficiary::factory()->create();

        DispersalEvent::factory()->initial($beneficiary)
            ->create(['date_dispersed' => now()->subMonths(3)->toDateString()]);

        $from = now()->subMonth()->startOfMonth()->toDateString();
        $to = now()->toDateString();

        $data = $this->chart('dispersal-trend', ['from' => $from, 'to' => $to]);

        // The window is exactly from..to — the 3-months-ago dispersal is out.
        $this->assertCount(2, $data);
        $this->assertSame(0, $data[0]['dispersals']);
        $this->assertSame(0, $data[1]['dispersals']);
    }

    public function test_animals_by_barangay_counts_all_covered_barangays(): void
    {
        $inDawis = Beneficiary::factory()->create(['address' => 'Dawis']);
        $inDawis2 = Beneficiary::factory()->create(['address' => 'Dawis']);
        $inTayawan = Beneficiary::factory()->create(['address' => 'Tayawan']);

        DispersalEvent::factory()->initial($inDawis)->create();
        DispersalEvent::factory()->initial($inDawis2)->create();
        DispersalEvent::factory()->initial($inTayawan)->create();

        $data = $this->chart('animals-by-barangay');

        $byBarangay = collect($data)->mapWithKeys(
            fn (array $row) => [$row['barangay'] => $row['dispersals']],
        );

        $this->assertSame(2, $byBarangay['Dawis']);
        $this->assertSame(1, $byBarangay['Tayawan']);

        // ZERO-FILL: a covered barangay with no dispersals still appears.
        $this->assertArrayHasKey('Ali-is', $byBarangay);
        $this->assertSame(0, $byBarangay['Ali-is']);
    }

    public function test_animals_by_barangay_respects_animal_type(): void
    {
        $carabao = Beneficiary::factory()->create(['address' => 'Dawis', 'animal_type' => 'Carabao']);
        $goat = Beneficiary::factory()->create(['address' => 'Dawis', 'animal_type' => 'Goat']);

        DispersalEvent::factory()->initial($carabao)->create();
        DispersalEvent::factory()->initial($goat)->create();

        $data = $this->chart('animals-by-barangay', ['animal_type' => 'Carabao']);

        $byBarangay = collect($data)->mapWithKeys(
            fn (array $row) => [$row['barangay'] => $row['dispersals']],
        );
        $this->assertSame(1, $byBarangay['Dawis']);
    }

    public function test_vaccination_compliance_reports_a_rate_per_month(): void
    {
        // One registered long ago and recently vaccinated: compliant.
        $compliant = Beneficiary::factory()->create(['address' => 'Dawis']);
        $compliant->forceFill(['created_at' => now()->subMonths(3)])->save();
        MonitoringRecord::factory()->for($compliant, 'beneficiary')
            ->create(['vaccination_date' => now()->subDays(10)->toDateString()]);

        // One registered long ago, never vaccinated: not compliant.
        $never = Beneficiary::factory()->create(['address' => 'Dawis']);
        $never->forceFill(['created_at' => now()->subMonths(3)])->save();

        $data = $this->chart('vaccination-compliance');

        $this->assertCount(12, $data);

        $current = $data[11];
        $this->assertSame(now()->format('Y-m'), $current['month']);
        $this->assertSame(2, $current['total']);
        $this->assertSame(1, $current['compliant']);
        // The JSON round-trip turns 50.0 into 50 — compare numerically.
        $this->assertSame(50.0, (float) $current['rate']);

        // Three months ago both animals were registered, but the vaccination
        // had not happened yet — the historical month is honest about that.
        $past = $data[8];
        $this->assertSame(2, $past['total']);
        $this->assertSame(0, $past['compliant']);
    }

    public function test_vaccination_compliance_survives_an_empty_program(): void
    {
        $data = $this->chart('vaccination-compliance');

        $this->assertCount(12, $data);
        $this->assertSame(0, $data[11]['total']);
        $this->assertNull($data[11]['rate']);
    }

    public function test_animal_type_distribution_groups_monitoring_records(): void
    {
        $thisMonth = now()->startOfMonth()->addDays(2)->toDateString();
        $lastMonth = now()->subMonth()->toDateString();

        // The type rides on the beneficiary, not the monitoring record.
        $carabao = Beneficiary::factory()->create(['animal_type' => 'Carabao']);
        $goat = Beneficiary::factory()->create(['animal_type' => 'Goat']);
        $otherMonth = Beneficiary::factory()->create(['animal_type' => 'Carabao']);

        MonitoringRecord::factory()->for($carabao, 'beneficiary')
            ->count(3)->create(['date_monitored' => $thisMonth]);
        MonitoringRecord::factory()->for($goat, 'beneficiary')
            ->create(['date_monitored' => $thisMonth]);
        // Outside the month filter — must not be counted.
        MonitoringRecord::factory()->for($otherMonth, 'beneficiary')
            ->create(['date_monitored' => $lastMonth]);

        $data = $this->chart('animal-type-distribution', ['month' => now()->format('Y-m')]);

        $byType = collect($data)->mapWithKeys(
            fn (array $row) => [$row['animal_type'] => $row['animals']],
        );
        $this->assertSame(3, $byType['Carabao']);
        $this->assertSame(1, $byType['Goat']);
    }

    public function test_technician_workload_counts_assigned_households_zero_filled(): void
    {
        $busy = User::factory()->create(['role' => 'technician']);
        $idle = User::factory()->create(['role' => 'technician']);

        Beneficiary::factory()->assignedTo($busy)->create(['address' => 'Dawis']);
        Beneficiary::factory()->assignedTo($busy)->create(['address' => 'Tayawan']);

        $data = $this->chart('technician-workload');

        $byName = collect($data)->mapWithKeys(
            fn (array $row) => [$row['technician'] => $row['households']],
        );
        $this->assertSame(2, $byName[$busy->name]);
        // An idle technician shows as zero rather than disappearing.
        $this->assertSame(0, $byName[$idle->name]);

        // Non-technicians never appear.
        $this->assertArrayNotHasKey('CVO Administrator', $byName);
    }

    public function test_technician_workload_respects_barangay(): void
    {
        $tech = User::factory()->create(['role' => 'technician']);
        Beneficiary::factory()->assignedTo($tech)->create(['address' => 'Dawis']);
        Beneficiary::factory()->assignedTo($tech)->create(['address' => 'Tayawan']);

        $data = $this->chart('technician-workload', ['barangay' => 'Dawis']);

        $this->assertSame(1, $data[0]['households']);
    }

    public function test_an_invalid_filter_is_rejected(): void
    {
        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/report/charts/dispersal-trend?from=not-a-date')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['from']);

        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/report/charts/animal-type-distribution?month=2026-13')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['month']);
    }
}
