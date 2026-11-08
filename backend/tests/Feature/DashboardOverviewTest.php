<?php

namespace Tests\Feature;

use App\Models\AnimalOwnershipEvent;
use App\Models\AnimalType;
use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\FieldVisit;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class DashboardOverviewTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function overview(User $user): array
    {
        return $this->actingAs($user)
            ->getJson('/api/v1/admin/dashboard')
            ->assertOk()
            ->json('data');
    }

    /**
     * The record factories eagerly create a technician account for every
     * monitoring row / field visit even when the test overrides
     * technician_id (the default runs before the override merges). Those
     * orphans hold no assignment and no visit, so they are pruned before any
     * roster or head-count assertion — the accounts the tests assert on are
     * the ones the test actually created.
     */
    private function pruneOrphanTechnicians(User $keep): void
    {
        User::query()
            ->where('role', 'technician')
            ->whereNull('deleted_at')
            ->where('id', '!=', $keep->id)
            ->whereNotIn('id', Beneficiary::query()->select('technician_id')->whereNotNull('technician_id'))
            ->whereNotIn('id', FieldVisit::query()->select('technician_id')->whereNotNull('technician_id'))
            // forceDelete: a soft delete would count as a "deactivated"
            // account and poison the roster test's own expectations.
            ->forceDelete();
    }

    protected function setUp(): void
    {
        parent::setUp();

        // The overview is cached app-wide; a previous test's answer must
        // never bleed into this suite's assertions.
        Cache::forget('dashboard:admin:v1');
    }

    public function test_a_guest_cannot_read_the_overview(): void
    {
        $this->getJson('/api/v1/admin/dashboard')->assertUnauthorized();
    }

    public function test_only_view_reports_holders_can_read_the_overview(): void
    {
        // The shipped seed gives view_reports to admin only.
        $this->actingAs(User::factory()->create(['role' => 'technician']))
            ->getJson('/api/v1/admin/dashboard')
            ->assertForbidden();
    }

    public function test_a_technician_granted_the_capability_can_read_the_overview(): void
    {
        // The matrix is the real gate: a grant on the Roles & Permissions
        // screen opens the overview for a technician, per endpoint.
        $permissionId = \DB::table('permissions')->where('key', 'view_reports')->value('id');
        \DB::table('role_permissions')->insert([
            'role' => 'technician',
            'permission_id' => $permissionId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs(User::factory()->create(['role' => 'technician']))
            ->getJson('/api/v1/admin/dashboard')
            ->assertOk();
    }

    public function test_the_overview_carries_every_section(): void
    {
        $data = $this->overview($this->admin());

        foreach ([
            'generated_at', 'kpis', 'monitoring', 'beneficiaries', 'field_visits',
            'technicians', 'dispersal', 'distribution', 'per_barangay', 'audit',
        ] as $key) {
            $this->assertArrayHasKey($key, $data);
        }

        foreach ([
            'beneficiaries', 'technicians_active', 'field_visits_total',
            'field_visits_last_30_days', 'monitoring_records', 'dispersal_records',
            'visits_needing_review',
        ] as $key) {
            $this->assertArrayHasKey($key, $data['kpis']);
        }
    }

    public function test_the_kpis_reflect_the_recorded_rows(): void
    {
        $admin = $this->admin();
        $technician = User::factory()->create(['role' => 'technician']);

        // BeneficiaryFactory always plants a GPS pin, so the geo-tagged KPI
        // is pinned by clearing the coordinates on everyone but one.
        $assigned = Beneficiary::factory()->count(3)
            ->create(['technician_id' => $technician->id, 'latitude' => null, 'longitude' => null]);
        $unassigned = Beneficiary::factory()->create(['latitude' => 9.36, 'longitude' => 122.85]);
        $all = $assigned->merge([$unassigned]);

        foreach ($all as $beneficiary) {
            MonitoringRecord::factory()->for($beneficiary, 'beneficiary')->by($technician)
                ->create(['date_monitored' => now()->subDays(2)->toDateString()]);
            FieldVisit::factory()->for($beneficiary, 'beneficiary')->by($technician)
                ->create(['visited_on' => now()->subDays(1)->toDateString()]);
        }
        // One old visit: inside `total`, outside the 30-day KPI.
        FieldVisit::factory()->for($unassigned, 'beneficiary')->by($technician)
            ->create(['visited_on' => now()->subDays(45)->toDateString()]);

        DispersalEvent::factory()->initial($assigned[0])->create();
        // Pin the ownership events to existing households — the factory
        // default would otherwise register a brand-new recipient.
        AnimalOwnershipEvent::factory()->to($assigned[1])->create(['event_type' => 'dispersal']);
        AnimalOwnershipEvent::factory()->to($assigned[2])->create(['event_type' => 're_dispersal']);

        $this->pruneOrphanTechnicians($technician);

        $data = $this->overview($admin);

        $this->assertSame(4, $data['kpis']['beneficiaries']['total']);
        $this->assertSame(1, $data['kpis']['beneficiaries']['geo_tagged']);
        $this->assertSame(1, $data['kpis']['technicians_active']);
        $this->assertSame(5, $data['kpis']['field_visits_total']);
        $this->assertSame(4, $data['kpis']['field_visits_last_30_days']);
        $this->assertSame(4, $data['kpis']['monitoring_records']);
        $this->assertSame(2, $data['kpis']['dispersal_records']);
    }

    public function test_monitoring_splits_households_across_livestock_and_poultry(): void
    {
        $admin = $this->admin();

        // The master list is seeded by migrations, so retag the seeded rows
        // rather than colliding with their unique names.
        $livestockType = AnimalType::query()->updateOrCreate(
            ['name' => 'Cattle'],
            ['main_category' => 'livestock', 'sort_order' => 1],
        );
        $poultryType = AnimalType::query()->updateOrCreate(
            ['name' => 'Chicken'],
            ['main_category' => 'poultry', 'sort_order' => 2],
        );

        $cow = Beneficiary::factory()->create(['animal_type_id' => $livestockType->id]);
        $hen = Beneficiary::factory()->create(['animal_type_id' => $poultryType->id]);
        $legacy = Beneficiary::factory()->create(['animal_type' => 'Duck']); // no master-list row

        MonitoringRecord::factory()->for($cow, 'beneficiary')->create(['date_monitored' => now()->toDateString()]);
        MonitoringRecord::factory()->for($cow, 'beneficiary')->create(['date_monitored' => now()->toDateString()]);
        MonitoringRecord::factory()->for($hen, 'beneficiary')->create(['date_monitored' => now()->toDateString()]);
        MonitoringRecord::factory()->for($legacy, 'beneficiary')->create(['date_monitored' => now()->toDateString()]);

        $data = $this->overview($admin);

        $this->assertSame(4, $data['monitoring']['total_records']);
        $this->assertSame(3, $data['monitoring']['monitored_households']);
        $this->assertSame(2, $data['monitoring']['by_category']['livestock']['records']);
        $this->assertSame(1, $data['monitoring']['by_category']['poultry']['records']);
        $this->assertSame(1, $data['monitoring']['by_category']['unspecified']['records']);
    }

    public function test_the_registration_trend_buckets_the_current_month(): void
    {
        $admin = $this->admin();

        Beneficiary::factory()->count(2)->create(); // created now
        $series = $this->overview($admin)['beneficiaries']['registrations_by_month'];

        $this->assertCount(12, $series);
        $this->assertSame(now()->format('Y-m'), $series[11]['month']);
        $this->assertSame(2, $series[11]['total']);
        // Trailing months with no registrations still appear, zero-filled.
        $this->assertSame(0, $series[0]['total']);
    }

    public function test_the_visit_section_carries_verdicts_and_recent_trips(): void
    {
        $admin = $this->admin();
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->create();

        FieldVisit::factory()->for($beneficiary, 'beneficiary')
            ->create([
                'technician_id' => $technician->id,
                'visited_on' => now()->subDays(1)->toDateString(),
                'purpose' => 'Monitoring',
                'verification_status' => 'on_site',
            ]);
        FieldVisit::factory()->for($beneficiary, 'beneficiary')
            ->create([
                'technician_id' => $technician->id,
                'visited_on' => now()->subDays(2)->toDateString(),
                'verification_status' => 'off_site',
            ]);

        $data = $this->overview($admin)['field_visits'];

        $this->assertSame(2, $data['verification']['total']);
        $this->assertSame(1, $data['verification']['counts']['on_site']);
        $this->assertSame(1, $data['verification']['review_count']);
        $this->assertCount(2, $data['recent']);
        $this->assertSame('Monitoring', $data['recent'][0]['purpose']);
        $this->assertSame($technician->name, $data['recent'][0]['technician_name']);
    }

    public function test_the_technician_roster_counts_assignments_and_visits(): void
    {
        $admin = $this->admin();
        $technician = User::factory()->create(['role' => 'technician']);
        User::factory()->create(['role' => 'technician', 'deleted_at' => now()]); // deactivated

        $beneficiary = Beneficiary::factory()->create(['technician_id' => $technician->id]);
        FieldVisit::factory()->for($beneficiary, 'beneficiary')->by($technician)
            ->create(['visited_on' => now()->subDays(3)->toDateString()]);
        FieldVisit::factory()->for($beneficiary, 'beneficiary')->by($technician)
            ->create(['visited_on' => now()->subDays(60)->toDateString()]);

        $this->pruneOrphanTechnicians($technician);

        $section = $this->overview($admin)['technicians'];

        $this->assertSame(1, $section['active']);
        $this->assertSame(1, $section['deactivated']);
        $this->assertCount(1, $section['roster']);

        $row = $section['roster'][0];
        $this->assertSame($technician->id, $row['id']);
        $this->assertSame(1, $row['assigned_households']);
        $this->assertSame(2, $row['visits_total']);
        $this->assertSame(1, $row['visits_last_30_days']);
        $this->assertSame(now()->subDays(3)->toDateString(), $row['last_visit_on']);
    }

    public function test_the_dispersal_section_counts_active_events_by_type(): void
    {
        $this->admin();

        AnimalOwnershipEvent::factory()->count(2)->create(['event_type' => 'dispersal']);
        AnimalOwnershipEvent::factory()->create(['event_type' => 're_dispersal']);
        AnimalOwnershipEvent::factory()->create(['event_type' => 'dispersal', 'status' => 'voided']);

        $data = $this->overview($this->admin())['dispersal'];

        $this->assertSame(2, $data['by_event_type']['dispersal']);
        $this->assertSame(1, $data['by_event_type']['re_dispersal']);
        // The 12-month trend rides the SAME ownership-chain events (not the
        // legacy dispersal_events table the Reports chart reads), month-filled.
        $this->assertCount(12, $data['trend']);
        $this->assertSame(2, $data['trend'][11]['dispersals']);
        $this->assertSame(1, $data['trend'][11]['re_dispersals']);
    }

    public function test_the_audit_section_lists_the_newest_actions(): void
    {
        $admin = $this->admin();
        $actor = User::factory()->create(['role' => 'admin']);

        app(\App\Services\AuditLogger::class)->log($actor->id, 'login', null);
        app(\App\Services\AuditLogger::class)->log($actor->id, 'settings_updated', null);

        $audit = $this->overview($admin)['audit'];

        // Account creations write their own audit rows, so the feed is longer
        // than the two actions above — but the newest rows are the logged
        // ones, newest action first, with the actor attached.
        $this->assertSame('settings_updated', $audit[0]['action']);
        $this->assertSame('login', $audit[1]['action']);
        $this->assertSame($actor->name, $audit[0]['actor_name']);
        $this->assertSame('admin', $audit[0]['actor_role']);
    }
}
