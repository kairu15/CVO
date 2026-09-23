<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\DispersalEvent;
use App\Models\FieldVisit;
use App\Models\HealthRecord;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReportTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function report(User $user, array $query = []): array
    {
        return $this->actingAs($user)
            ->getJson('/api/v1/admin/report'.(empty($query) ? '' : '?'.http_build_query($query)))
            ->assertOk()
            ->json('data');
    }

    public function test_a_guest_cannot_read_the_report(): void
    {
        $this->getJson('/api/v1/admin/report')->assertUnauthorized();
    }

    public function test_only_admins_can_read_the_report(): void
    {
        foreach (['doctor', 'technician', 'farmer'] as $role) {
            $this->actingAs(User::factory()->create(['role' => $role]))
                ->getJson('/api/v1/admin/report')
                ->assertForbidden();
        }
    }

    public function test_the_report_counts_the_program(): void
    {
        $admin = $this->admin();
        $farmer = User::factory()->create(['role' => 'farmer']);

        Beneficiary::factory()->forFarmer($farmer)->count(3)->create();
        Beneficiary::factory()->create(['technician_id' => null]);

        $data = $this->report($admin);

        $this->assertSame(4, $data['program']['households']);
        $this->assertSame(4, $data['program']['animals']);
        $this->assertSame(4, $data['program']['unassigned']);
        $this->assertSame(0, $data['program']['with_technician']);
    }

    public function test_activity_counts_reflect_the_recorded_rows(): void
    {
        $admin = $this->admin();
        $farmer = User::factory()->create(['role' => 'farmer']);
        $tech = User::factory()->create(['role' => 'technician']);

        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->assignedTo($tech)->create();

        MonitoringRecord::factory()->for($beneficiary, 'beneficiary')->create();
        FieldVisit::factory()->for($beneficiary, 'beneficiary')->create(['latitude' => 9.3, 'longitude' => 122.8]);
        FieldVisit::factory()->for($beneficiary, 'beneficiary')->create(['latitude' => null, 'longitude' => null]);
        DispersalEvent::factory()->create(['beneficiary_id' => $beneficiary->id, 'dispersal_type' => 'initial']);
        DispersalEvent::factory()->create(['beneficiary_id' => $beneficiary->id, 'dispersal_type' => 're-dispersal']);

        $data = $this->report($admin);

        $this->assertSame(1, $data['activity']['monitoring_visits']);
        $this->assertSame(2, $data['activity']['field_visits']);
        $this->assertSame(1, $data['activity']['field_visits_with_location']);
        $this->assertSame(2, $data['activity']['dispersals']);
        $this->assertSame(1, $data['activity']['re_dispersals']);
    }

    public function test_clinical_counts_use_the_configured_outcome_vocabulary(): void
    {
        $admin = $this->admin();
        $farmer = User::factory()->create(['role' => 'farmer']);

        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->create();

        HealthRecord::factory()->for($beneficiary, 'beneficiary')->create(['outcome' => 'recovered']);
        HealthRecord::factory()->for($beneficiary, 'beneficiary')->create(['outcome' => 'ongoing']);
        HealthRecord::factory()->for($beneficiary, 'beneficiary')->create(['outcome' => null]);
        CaseNote::factory()->for($beneficiary, 'beneficiary')->create();
        MonitoringRecord::factory()->for($beneficiary, 'beneficiary')->create(['vaccination_date' => now()->toDateString()]);

        $data = $this->report($admin);

        $this->assertSame(3, $data['clinical']['health_records']);
        // Null outcome and "ongoing" both count as open; "recovered" does not.
        $this->assertSame(2, $data['clinical']['open_cases']);
        $this->assertSame(1, $data['clinical']['by_outcome']['recovered']);
        $this->assertSame(1, $data['clinical']['case_notes']);
        $this->assertSame(1, $data['clinical']['vaccinations']);
    }

    public function test_the_per_barangay_table_covers_every_barangay_with_rows(): void
    {
        $admin = $this->admin();
        $farmer = User::factory()->create(['role' => 'farmer']);

        $a = Beneficiary::factory()->forFarmer($farmer)->create(['address' => 'Banay Banay']);
        $b = Beneficiary::factory()->forFarmer($farmer)->create(['address' => 'Dawis']);
        Beneficiary::factory()->forFarmer($farmer)->create(['address' => 'Banay Banay']);

        MonitoringRecord::factory()->for($a, 'beneficiary')->create();

        $data = $this->report($admin);

        $rows = array_column($data['per_barangay'], null, 'barangay');

        $this->assertSame(2, $rows['Banay Banay']['households']);
        $this->assertSame(1, $rows['Dawis']['households']);
        // A barangay with households but no visits still appears, with zeros.
        $this->assertSame(0, $rows['Dawis']['monitoring_visits']);
        $this->assertSame(1, $rows['Banay Banay']['monitoring_visits']);
        // Both barangays with households appear — exactly two rows.
        $this->assertCount(2, $rows);
    }

    public function test_the_barangay_filter_narrows_every_section(): void
    {
        $admin = $this->admin();
        $farmer = User::factory()->create(['role' => 'farmer']);

        $inScope = Beneficiary::factory()->forFarmer($farmer)->create(['address' => 'Banay Banay']);
        $outOfScope = Beneficiary::factory()->forFarmer($farmer)->create(['address' => 'Dawis']);

        MonitoringRecord::factory()->for($inScope, 'beneficiary')->create();
        MonitoringRecord::factory()->for($outOfScope, 'beneficiary')->create();
        HealthRecord::factory()->for($outOfScope, 'beneficiary')->create();
        FieldVisit::factory()->for($outOfScope, 'beneficiary')->create();

        $data = $this->report($admin, ['barangay' => 'Banay Banay']);

        $this->assertSame(1, $data['program']['households']);
        $this->assertSame(1, $data['activity']['monitoring_visits']);
        $this->assertSame(0, $data['activity']['field_visits']);
        $this->assertSame(0, $data['clinical']['health_records']);
    }

    public function test_the_trend_covers_the_trailing_months_with_zeroes(): void
    {
        $admin = $this->admin();
        $farmer = User::factory()->create(['role' => 'farmer']);

        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->create();

        DispersalEvent::factory()->create([
            'beneficiary_id' => $beneficiary->id,
            'dispersal_type' => 'initial',
            'date_dispersed' => now()->startOfMonth()->toDateString(),
        ]);
        // A dispersal older than the window must not create a month row.
        DispersalEvent::factory()->create([
            'beneficiary_id' => $beneficiary->id,
            'dispersal_type' => 'initial',
            'date_dispersed' => now()->subMonths(8)->toDateString(),
        ]);

        $data = $this->report($admin);

        $this->assertCount(6, $data['trend']);
        $this->assertSame(1, $data['trend'][5]['dispersals']);
        $this->assertSame(0, $data['trend'][0]['dispersals']);

        // Months are oldest-first and labelled for display.
        $this->assertSame(now()->subMonths(5)->startOfMonth()->format('Y-m'), $data['trend'][0]['month']);
    }

    public function test_an_unknown_barangay_yields_an_empty_but_valid_report(): void
    {
        $data = $this->report($this->admin(), ['barangay' => 'Not A Barangay']);

        $this->assertSame(0, $data['program']['households']);
        $this->assertSame([], $data['per_barangay']);
        $this->assertSame(0, $data['activity']['dispersals']);
    }

    public function test_a_from_date_adds_the_since_counter(): void
    {
        $admin = $this->admin();
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->create();

        DispersalEvent::factory()->create([
            'beneficiary_id' => $beneficiary->id,
            'date_dispersed' => now()->subDays(2)->toDateString(),
        ]);
        DispersalEvent::factory()->create([
            'beneficiary_id' => $beneficiary->id,
            'date_dispersed' => now()->subDays(20)->toDateString(),
        ]);

        $data = $this->report($admin, ['from' => now()->subDays(7)->toDateString()]);

        $this->assertSame(2, $data['activity']['dispersals']);
        $this->assertSame(1, $data['activity']['dispersals_since']);
    }
}
