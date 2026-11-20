<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Animal;
use App\Models\AnimalOwnershipEvent;
use App\Models\AnimalType;
use App\Models\Barangay;
use App\Models\Beneficiary;
use App\Models\CaseNote;
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

    private function type(string $name): AnimalType
    {
        $category = in_array($name, ['Chicken', 'Duck', 'Quail', 'Turkey', 'Goose'], true)
            ? 'poultry'
            : 'livestock';

        return AnimalType::query()->firstOrCreate(
            ['name' => $name],
            ['main_category' => $category, 'sort_order' => 0],
        );
    }

    private function animalFor(Beneficiary $beneficiary, string $typeName = 'Carabao'): Animal
    {
        $type = $this->type($typeName);

        return Animal::factory()->ownedBy($beneficiary)->create([
            'animal_type' => $type->name,
            'animal_type_id' => $type->id,
        ]);
    }

    /**
     * One canonical delivery into a household. Reports read this table, not
     * the older beneficiary-centric dispersal log.
     */
    private function delivery(
        Beneficiary $beneficiary,
        array $attributes = [],
        string $eventType = AnimalOwnershipEvent::TYPE_DISPERSAL,
        ?Animal $animal = null,
    ): AnimalOwnershipEvent {
        $barangayId = $beneficiary->barangay_id
            ?? Barangay::query()->where('name', $beneficiary->address)->value('id');

        $beneficiary->forceFill(['barangay_id' => $barangayId])->save();

        return AnimalOwnershipEvent::factory()
            ->forAnimal($animal ?? $this->animalFor($beneficiary))
            ->to($beneficiary)
            ->create([
                'event_type' => $eventType,
                'event_date' => now()->toDateString(),
                'to_barangay_id' => $barangayId,
                ...$attributes,
            ]);
    }

    private function barangay(string $name): Barangay
    {
        return Barangay::query()->firstOrCreate(
            ['name' => $name],
            ['latitude' => 9.3, 'longitude' => 122.8],
        );
    }

    public function test_a_guest_cannot_read_the_report(): void
    {
        $this->getJson('/api/v1/admin/report')->assertUnauthorized();
    }

    public function test_only_admins_can_read_the_report(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'technician']))
            ->getJson('/api/v1/admin/report')
            ->assertForbidden();
    }

    public function test_the_report_counts_the_program(): void
    {
        $admin = $this->admin();

        $beneficiaries = Beneficiary::factory()->count(4)->create(['technician_id' => null]);
        $beneficiaries->each(fn (Beneficiary $beneficiary) => $this->animalFor($beneficiary));

        $data = $this->report($admin);

        $this->assertSame(4, $data['program']['households']);
        $this->assertSame(4, $data['program']['animals']);
        $this->assertSame(4, $data['program']['unassigned']);
        $this->assertSame(0, $data['program']['with_technician']);
    }

    public function test_activity_and_dispersal_counts_reflect_the_recorded_rows(): void
    {
        $admin = $this->admin();
        $tech = User::factory()->create(['role' => 'technician']);

        $beneficiary = Beneficiary::factory()->assignedTo($tech)->create();

        MonitoringRecord::factory()->for($beneficiary, 'beneficiary')->create();
        FieldVisit::factory()->for($beneficiary, 'beneficiary')->create(['latitude' => 9.3, 'longitude' => 122.8]);
        FieldVisit::factory()->for($beneficiary, 'beneficiary')->create(['latitude' => null, 'longitude' => null]);
        $this->delivery($beneficiary);
        $this->delivery($beneficiary, [], AnimalOwnershipEvent::TYPE_RE_DISPERSAL);

        $data = $this->report($admin);

        $this->assertSame(1, $data['activity']['monitoring_visits']);
        $this->assertSame(2, $data['activity']['field_visits']);
        $this->assertSame(1, $data['activity']['field_visits_with_location']);
        $this->assertSame(2, $data['activity']['dispersals']);
        $this->assertSame(1, $data['activity']['re_dispersals']);
        $this->assertSame(2, $data['dispersals']['total']);
        $this->assertSame(1, $data['dispersals']['initial']);
        $this->assertSame(1, $data['dispersals']['re_dispersals']);
    }

    public function test_the_overview_splits_livestock_and_poultry_from_the_master_list(): void
    {
        $admin = $this->admin();
        $dawis = $this->barangay('Dawis');

        $livestock = Beneficiary::factory()->create([
            'address' => $dawis->name,
            'barangay_id' => $dawis->id,
            'animal_type' => 'Carabao',
            'animal_type_id' => $this->type('Carabao')->id,
        ]);
        $poultry = Beneficiary::factory()->create([
            'address' => $dawis->name,
            'barangay_id' => $dawis->id,
            'animal_type' => 'Chicken',
            'animal_type_id' => $this->type('Chicken')->id,
        ]);

        $this->delivery($livestock);
        $this->delivery($poultry, [], AnimalOwnershipEvent::TYPE_DISPERSAL, $this->animalFor($poultry, 'Chicken'));

        $all = $this->report($admin);
        $this->assertSame(2, $all['dispersals']['total']);
        $this->assertSame(1, $all['dispersals']['livestock']);
        $this->assertSame(1, $all['dispersals']['poultry']);
        $this->assertSame(0, $all['dispersals']['unclassified']);

        $poultryOnly = $this->report($admin, ['category' => 'poultry']);
        $this->assertSame(1, $poultryOnly['program']['households']);
        $this->assertSame(1, $poultryOnly['dispersals']['total']);
        $this->assertSame(0, $poultryOnly['dispersals']['livestock']);
        $this->assertSame(1, $poultryOnly['dispersals']['poultry']);
    }

    public function test_pending_follow_up_counts_unassigned_and_overdue_households(): void
    {
        $admin = $this->admin();
        $tech = User::factory()->create(['role' => 'technician']);

        Beneficiary::factory()->create(['technician_id' => null]);

        $assigned = Beneficiary::factory()->assignedTo($tech)->create();
        MonitoringRecord::factory()->for($assigned, 'beneficiary')->create([
            'date_monitored' => now()->toDateString(),
        ]);

        $data = $this->report($admin);

        $this->assertSame(1, $data['program']['unassigned']);
        $this->assertSame(1, $data['program']['pending_follow_up']);
        $this->assertSame(60, $data['program']['follow_up_days']);
    }

    public function test_clinical_counts_use_the_configured_outcome_vocabulary(): void
    {
        $admin = $this->admin();

        $beneficiary = Beneficiary::factory()->create();

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
        $first = $this->barangay('Dawis');
        $second = $this->barangay('Tayawan');

        $a = Beneficiary::factory()->create(['address' => $first->name, 'barangay_id' => $first->id]);
        $b = Beneficiary::factory()->create(['address' => $second->name, 'barangay_id' => $second->id]);
        Beneficiary::factory()->create(['address' => $first->name, 'barangay_id' => $first->id]);

        MonitoringRecord::factory()->for($a, 'beneficiary')->create();
        $this->delivery($a);

        $data = $this->report($admin);

        $rows = array_column($data['per_barangay'], null, 'barangay');

        $this->assertSame(2, $rows[$first->name]['households']);
        $this->assertSame(1, $rows[$second->name]['households']);
        // A barangay with households but no visits still appears, with zeros.
        $this->assertSame(0, $rows[$second->name]['monitoring_visits']);
        $this->assertSame(1, $rows[$first->name]['monitoring_visits']);
        $this->assertSame(1, $rows[$first->name]['dispersals']);
        $this->assertSame(1, $rows[$first->name]['livestock']);
        $this->assertSame(0, $rows[$second->name]['dispersals']);
        // Both barangays with households appear — exactly two rows.
        $this->assertCount(2, $rows);
    }

    public function test_the_barangay_filter_narrows_every_section(): void
    {
        $admin = $this->admin();
        $first = $this->barangay('Dawis');
        $second = $this->barangay('Tayawan');

        $inScope = Beneficiary::factory()->create(['address' => $first->name, 'barangay_id' => $first->id]);
        $outOfScope = Beneficiary::factory()->create(['address' => $second->name, 'barangay_id' => $second->id]);

        MonitoringRecord::factory()->for($inScope, 'beneficiary')->create();
        MonitoringRecord::factory()->for($outOfScope, 'beneficiary')->create();
        HealthRecord::factory()->for($outOfScope, 'beneficiary')->create();
        FieldVisit::factory()->for($outOfScope, 'beneficiary')->create();
        $this->delivery($inScope);
        $this->delivery($outOfScope);

        $data = $this->report($admin, ['barangay' => $first->name]);

        $this->assertSame(1, $data['program']['households']);
        $this->assertSame(1, $data['activity']['monitoring_visits']);
        $this->assertSame(0, $data['activity']['field_visits']);
        $this->assertSame(0, $data['clinical']['health_records']);
        $this->assertSame(1, $data['dispersals']['total']);
        $this->assertCount(1, $data['per_barangay']);
    }

    public function test_the_trend_covers_the_trailing_months_with_zeroes(): void
    {
        $admin = $this->admin();

        $beneficiary = Beneficiary::factory()->create();

        $this->delivery($beneficiary, ['event_date' => now()->startOfMonth()->toDateString()]);
        // A dispersal older than the window must not create a month row.
        $this->delivery($beneficiary, ['event_date' => now()->subMonths(8)->toDateString()]);

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

    public function test_a_date_range_narrows_the_dispersal_figures(): void
    {
        $admin = $this->admin();
        $beneficiary = Beneficiary::factory()->create();

        $this->delivery($beneficiary, ['event_date' => now()->subDays(2)->toDateString()]);
        $this->delivery($beneficiary, ['event_date' => now()->subDays(20)->toDateString()]);

        $data = $this->report($admin, [
            'from' => now()->subDays(7)->toDateString(),
            'to' => now()->toDateString(),
        ]);

        $this->assertSame(1, $data['activity']['dispersals']);
        $this->assertSame(1, $data['dispersals']['total']);
    }

    public function test_beneficiary_and_dispersal_status_filters_narrow_the_report(): void
    {
        $admin = $this->admin();
        $dawis = $this->barangay('Dawis');
        $maria = Beneficiary::factory()->create([
            'name_of_farmer' => 'Maria Santos',
            'address' => $dawis->name,
            'barangay_id' => $dawis->id,
        ]);
        $other = Beneficiary::factory()->create([
            'name_of_farmer' => 'Juan Cruz',
            'address' => $dawis->name,
            'barangay_id' => $dawis->id,
        ]);

        $this->delivery($maria);
        $this->delivery($maria, [], AnimalOwnershipEvent::TYPE_RE_DISPERSAL);
        $this->delivery($other);
        MonitoringRecord::factory()->for($maria, 'beneficiary')->create();
        MonitoringRecord::factory()->for($other, 'beneficiary')->create();
        FieldVisit::factory()->for($maria, 'beneficiary')->create();
        HealthRecord::factory()->for($other, 'beneficiary')->create();

        $person = $this->report($admin, ['beneficiary' => 'Maria Santos']);
        $this->assertSame(1, $person['program']['households']);
        $this->assertSame(2, $person['dispersals']['total']);
        $this->assertCount(1, $person['per_barangay']);
        $this->assertSame(1, $person['per_barangay'][0]['households']);
        $this->assertSame(1, $person['per_barangay'][0]['monitoring_visits']);
        $this->assertSame(1, $person['per_barangay'][0]['field_visits']);
        $this->assertSame(0, $person['per_barangay'][0]['health_records']);
        $this->assertSame(2, $person['per_barangay'][0]['dispersals']);

        $redisbursed = $this->report($admin, [
            'beneficiary' => 'Maria',
            'dispersal_type' => 're_dispersal',
        ]);

        $this->assertSame(1, $redisbursed['dispersals']['total']);
        $this->assertSame(0, $redisbursed['dispersals']['initial']);
        $this->assertSame(1, $redisbursed['dispersals']['re_dispersals']);
    }

    public function test_recent_exports_are_read_from_the_audit_trail(): void
    {
        $admin = $this->admin();

        ActivityLog::create([
            'actor_id' => $admin->id,
            'actor_name' => $admin->name,
            'actor_email' => $admin->email,
            'actor_role' => $admin->role,
            'action' => 'exported',
            'new_values' => [
                'resource' => 'report_template',
                'report_name' => 'Dawis September Report',
                'filters' => ['barangay' => 'Dawis', 'month' => '2026-09'],
            ],
        ]);

        $data = $this->actingAs($admin)
            ->getJson('/api/v1/admin/report/recent')
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $data);
        $this->assertSame('Dawis September Report', $data[0]['title']);
        $this->assertSame('Livestock dispersal report', $data[0]['category']);
        $this->assertSame('Dawis', $data[0]['filters']['barangay']);
        $this->assertSame($admin->name, $data[0]['actor']);
    }
}
