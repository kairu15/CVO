<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The month/year tab filter on the monitoring table.
 *
 * The filter is a backend query parameter on `date_monitored` — the field
 * the CVO report is organized by — applied BEFORE pagination, so a month's
 * meta.total is the month's real count rather than a page-sized slice of a
 * pre-filtered fetch.
 */
class MonitoringMonthFilterTest extends TestCase
{
    use RefreshDatabase;

    private User $technician;

    private Beneficiary $beneficiary;

    protected function setUp(): void
    {
        parent::setUp();

        $this->technician = User::factory()->create(['role' => 'technician']);
        $this->beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create();
    }

    /** One record per month across three non-contiguous months. */
    private function seedSparseMonths(): void
    {
        foreach (['2024-06-15', '2025-01-08', '2026-09-21'] as $date) {
            MonitoringRecord::factory()->by($this->technician)
                ->for($this->beneficiary, 'beneficiary')
                ->create(['date_monitored' => $date]);
        }
    }

    public function test_month_filter_returns_every_record_for_the_month(): void
    {
        $this->seedSparseMonths();

        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?month=2026-09')
            ->assertOk()
            // Exactly one record lives in Sep 2026 — the sparse-month edge:
            // one row is data, not a truncation.
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.date_monitored', '2026-09-21');
    }

    public function test_meta_total_is_the_real_month_count_not_a_page_slice(): void
    {
        // Six records in one month — more than the default page size of 15
        // would matter for, so seed enough to cross a per_page bound instead.
        MonitoringRecord::factory()->count(7)->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create(['date_monitored' => '2025-08-01']);
        MonitoringRecord::factory()->count(3)->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create(['date_monitored' => '2025-07-30']);

        // per_page=5 with the filter applied server-side: the month has 7
        // rows, so page 1 carries 5 of them and meta.total must still say 7.
        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?month=2025-08&per_page=5')
            ->assertOk()
            ->assertJsonCount(5, 'data')
            ->assertJsonPath('meta.total', 7)
            ->assertJsonPath('meta.current_page', 1)
            ->assertJsonPath('meta.last_page', 2);
    }

    public function test_filter_buckets_on_date_monitored_not_created_at(): void
    {
        // Monitored in Jun 2024 but imported (created) in Sep 2026 — the
        // record belongs to Jun 2024's tab, the field the report sheets
        // are organized by.
        MonitoringRecord::factory()->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create([
                'date_monitored' => '2024-06-15',
                'created_at' => '2026-09-10 10:00:00',
            ]);

        $june = $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?month=2024-06')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $september = $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?month=2026-09')
            ->assertOk();

        $june->assertJsonPath('meta.total', 1);
        $september->assertJsonCount(0, 'data')->assertJsonPath('meta.total', 0);
    }

    public function test_months_endpoint_lists_only_months_with_records_chronologically(): void
    {
        // Two records share Sep 2026 — the tab list must stay distinct.
        MonitoringRecord::factory()->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create(['date_monitored' => '2026-09-02']);

        $this->seedSparseMonths();

        $response = $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records/months')
            ->assertOk();

        $this->assertSame(
            ['2024-06', '2025-01', '2026-09'],
            $response->json('data'),
        );
    }

    public function test_months_endpoint_is_scoped_to_the_caller(): void
    {
        $this->seedSparseMonths();

        $other = User::factory()->create(['role' => 'technician']);
        $otherBeneficiary = Beneficiary::factory()->assignedTo($other)->create();
        MonitoringRecord::factory()->by($other)->for($otherBeneficiary, 'beneficiary')
            ->create(['date_monitored' => '2020-03-01']);

        // A technician never sees another technician's months.
        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records/months')
            ->assertOk()
            ->assertJsonPath('data', ['2024-06', '2025-01', '2026-09']);
    }

    public function test_farmer_months_cover_only_their_own_records(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $own = Beneficiary::factory()->forFarmer($farmer)->create();

        MonitoringRecord::factory()->by($this->technician)->for($own, 'beneficiary')
            ->create(['date_monitored' => '2025-01-08']);
        MonitoringRecord::factory()->by($this->technician)->for($this->beneficiary, 'beneficiary')
            ->create(['date_monitored' => '2026-09-21']);

        $this->actingAs($farmer)
            ->getJson('/api/v1/monitoring-records/months')
            ->assertOk()
            ->assertJsonPath('data', ['2025-01']);
    }

    public function test_month_filter_rejects_an_invalid_bucket(): void
    {
        $this->seedSparseMonths();

        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?month=September')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['month']);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?month=2026-9')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['month']);
    }

    public function test_records_without_a_date_monitored_never_appear_in_a_month_tab(): void
    {
        // Imported rows can carry no usable date — they must not join a
        // bucket they do not belong to.
        MonitoringRecord::factory()->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create(['date_monitored' => null]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records/months')
            ->assertOk()
            ->assertJsonPath('data', []);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/monitoring-records?month=2026-09')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }
}
