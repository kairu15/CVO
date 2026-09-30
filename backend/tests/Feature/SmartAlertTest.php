<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use App\Models\UserNotification;
use App\Services\SmartAlertService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Smart Alerts: the daily, rule-based scan. Plain SQL aggregation and
 * threshold comparisons over existing records — no model, no external API.
 *
 * These tests pin the three things that make the scan safe to schedule daily:
 * each rule fires on the right record, re-running does not duplicate rows, and
 * an alert whose condition is fixed is cleared.
 */
class SmartAlertTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function scan(): void
    {
        $this->artisan('alerts:compute-smart')->assertSuccessful();
    }

    public function test_overdue_vaccination_alerts_admins_and_the_assigned_technician(): void
    {
        $admin = $this->admin();
        $technician = User::factory()->create(['role' => 'technician']);
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()
            ->forFarmer($farmer)
            ->assignedTo($technician)
            ->create();

        MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->by($technician)
            ->create([
                'vaccination_date' => now()->subDays(200),
                'date_monitored' => now()->subDays(200),
            ]);

        $this->scan();

        $this->assertDatabaseHas('user_notifications', [
            'user_id' => $admin->id,
            'type' => UserNotification::TYPE_SMART_VACCINATION_OVERDUE,
            'beneficiary_id' => $beneficiary->id,
        ]);

        $this->assertDatabaseHas('user_notifications', [
            'user_id' => $technician->id,
            'type' => UserNotification::TYPE_SMART_VACCINATION_OVERDUE,
            'beneficiary_id' => $beneficiary->id,
        ]);
    }

    public function test_a_recent_vaccination_does_not_alert(): void
    {
        $this->admin();
        $beneficiary = Beneficiary::factory()->create();

        MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->create([
                'vaccination_date' => now()->subDays(10),
                'date_monitored' => now()->subDays(10),
            ]);

        $this->scan();

        $this->assertDatabaseMissing('user_notifications', [
            'type' => UserNotification::TYPE_SMART_VACCINATION_OVERDUE,
        ]);
    }

    public function test_rerunning_the_scan_does_not_duplicate_alerts(): void
    {
        $admin = $this->admin();
        $beneficiary = Beneficiary::factory()->create();

        MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->create([
                'vaccination_date' => now()->subDays(200),
                'date_monitored' => now()->subDays(200),
            ]);

        $this->scan();
        $this->scan();

        $this->assertSame(1, UserNotification::query()
            ->where('type', UserNotification::TYPE_SMART_VACCINATION_OVERDUE)
            ->where('user_id', $admin->id)
            ->count());
    }

    public function test_fixing_the_record_clears_the_alert(): void
    {
        $admin = $this->admin();
        $beneficiary = Beneficiary::factory()->create();

        $record = MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->create([
                'vaccination_date' => now()->subDays(200),
                'date_monitored' => now()->subDays(200),
            ]);

        $this->scan();

        $this->assertDatabaseHas('user_notifications', [
            'type' => UserNotification::TYPE_SMART_VACCINATION_OVERDUE,
        ]);

        // A newer vaccination is recorded; the animal is no longer overdue.
        MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->create([
                'vaccination_date' => now()->subDays(5),
                'date_monitored' => now(),
            ]);

        $this->scan();

        $this->assertDatabaseMissing('user_notifications', [
            'type' => UserNotification::TYPE_SMART_VACCINATION_OVERDUE,
        ]);
    }

    public function test_no_recent_visit_flags_an_established_household(): void
    {
        $this->admin();

        // Registered 60 days ago, never visited.
        $this->travelTo(now()->subDays(60));
        $beneficiary = Beneficiary::factory()->create();
        $this->travelBack();

        $this->scan();

        $this->assertDatabaseHas('user_notifications', [
            'type' => UserNotification::TYPE_SMART_NO_RECENT_VISIT,
            'beneficiary_id' => $beneficiary->id,
        ]);

        // A fresh household is not flagged: it has had no chance to be visited.
        $newBeneficiary = Beneficiary::factory()->create();

        $this->scan();

        $this->assertDatabaseMissing('user_notifications', [
            'type' => UserNotification::TYPE_SMART_NO_RECENT_VISIT,
            'beneficiary_id' => $newBeneficiary->id,
        ]);
    }

    public function test_bcs_rule_can_be_disabled_by_clearing_both_ranges(): void
    {
        // The shipped config enables the rule (general band 2–4); clearing both
        // the general band and any overrides is the documented way to disable.
        config([
            'cvo.smart_alerts.bcs_normal_range' => null,
            'cvo.smart_alerts.bcs_normal_ranges' => [],
        ]);

        $this->admin();

        $beneficiary = Beneficiary::factory()->create(['animal_type' => 'Goat']);

        MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->create(['bcs' => 1, 'date_monitored' => now()]);

        $this->scan();

        $this->assertDatabaseMissing('user_notifications', [
            'type' => UserNotification::TYPE_SMART_BCS_OUT_OF_RANGE,
        ]);

        $this->assertFalse(app(SmartAlertService::class)->bcsRuleEnabled());
    }

    public function test_bcs_rule_uses_the_general_range_for_every_species(): void
    {
        $this->admin();

        // No config override here: the shipped general band (2–4) applies.
        $outside = Beneficiary::factory()->create(['animal_type' => 'Carabao']);
        MonitoringRecord::factory()
            ->for($outside, 'beneficiary')
            ->create(['bcs' => 5, 'date_monitored' => now()]);

        $inside = Beneficiary::factory()->create(['animal_type' => 'Goat']);
        MonitoringRecord::factory()
            ->for($inside, 'beneficiary')
            ->create(['bcs' => 3, 'date_monitored' => now()]);

        $this->scan();

        $this->assertDatabaseHas('user_notifications', [
            'type' => UserNotification::TYPE_SMART_BCS_OUT_OF_RANGE,
            'beneficiary_id' => $outside->id,
        ]);

        $this->assertDatabaseMissing('user_notifications', [
            'type' => UserNotification::TYPE_SMART_BCS_OUT_OF_RANGE,
            'beneficiary_id' => $inside->id,
        ]);

        $this->assertTrue(app(SmartAlertService::class)->bcsRuleEnabled());
    }

    public function test_bcs_rule_flags_a_score_outside_a_confirmed_range(): void
    {
        $this->admin();
        config(['cvo.smart_alerts.bcs_normal_ranges' => ['Goat' => [2, 4]]]);

        $beneficiary = Beneficiary::factory()->create(['animal_type' => 'Goat']);

        MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->create(['bcs' => 1, 'date_monitored' => now()]);

        $this->scan();

        $this->assertDatabaseHas('user_notifications', [
            'type' => UserNotification::TYPE_SMART_BCS_OUT_OF_RANGE,
            'beneficiary_id' => $beneficiary->id,
        ]);
    }

    public function test_barangay_flag_rate_flags_only_the_barangay_above_the_city_share(): void
    {
        $this->admin();

        // Real coverage names, because BeneficiaryFactory resolves coordinates
        // through App\Support\Barangays, which prefers the table.
        $flagged = Barangay::create(['name' => 'Ali-is', 'latitude' => 9.5325654, 'longitude' => 122.8933552]);
        $calm = Barangay::create(['name' => 'Banaybanay', 'latitude' => 9.5526855, 'longitude' => 122.8242983]);

        $flaggedHousehold = Beneficiary::factory()->create(['barangay_id' => $flagged->id]);
        $calmHousehold = Beneficiary::factory()->create(['barangay_id' => $calm->id]);

        // Flagged barangay: 4 of 5 records carry a concern remark (80%).
        for ($i = 0; $i < 4; $i++) {
            MonitoringRecord::factory()->for($flaggedHousehold, 'beneficiary')->create([
                'remarks' => 'Sick animal',
                'date_monitored' => now(),
            ]);
        }

        MonitoringRecord::factory()->for($flaggedHousehold, 'beneficiary')->create([
            'remarks' => 'Healthy',
            'date_monitored' => now(),
        ]);

        // Calm barangay: 0 of 5 (0%). City-wide = 4/10 = 40%, threshold = 60%.
        for ($i = 0; $i < 5; $i++) {
            MonitoringRecord::factory()->for($calmHousehold, 'beneficiary')->create([
                'remarks' => 'Healthy',
                'date_monitored' => now(),
            ]);
        }

        $this->scan();

        $alerts = UserNotification::query()
            ->where('type', UserNotification::TYPE_SMART_BARANGAY_FLAG)
            ->get();

        $this->assertCount(1, $alerts);
        $this->assertStringContainsString('Ali-is', $alerts->first()->message);
    }

    public function test_small_barangays_are_not_flagged(): void
    {
        $this->admin();
        config(['cvo.smart_alerts.barangay_flag_min_records' => 5]);

        $barangay = Barangay::create(['name' => 'Banga', 'latitude' => 9.3699825, 'longitude' => 122.7960402]);
        $household = Beneficiary::factory()->create(['barangay_id' => $barangay->id]);

        // One concern out of one record: 100%, but below the sample floor.
        MonitoringRecord::factory()->for($household, 'beneficiary')->create([
            'remarks' => 'Sick',
            'date_monitored' => now(),
        ]);

        $this->scan();

        $this->assertDatabaseMissing('user_notifications', [
            'type' => UserNotification::TYPE_SMART_BARANGAY_FLAG,
        ]);
    }

    public function test_the_smart_filter_returns_only_flags_and_reports_their_count(): void
    {
        $admin = $this->admin();
        $beneficiary = Beneficiary::factory()->create();

        // `bcs` within the general band, so only the vaccination rule fires
        // and the count this test asserts stays deterministic.
        MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->create([
                'vaccination_date' => now()->subDays(200),
                'date_monitored' => now()->subDays(200),
                'bcs' => 3,
            ]);

        // An ordinary stored event also exists for the same admin.
        UserNotification::create([
            'user_id' => $admin->id,
            'type' => UserNotification::TYPE_REGISTRATION_NEW,
            'title' => 'New farmer registered',
            'message' => 'A routine event.',
        ]);

        $this->scan();

        $this->actingAs($admin)
            ->getJson('/api/v1/notifications?filter=smart')
            ->assertOk()
            ->assertJsonPath('meta.smart', 1)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', UserNotification::TYPE_SMART_VACCINATION_OVERDUE)
            ->assertJsonPath('data.0.is_smart', true);

        // The unfiltered feed still carries both, with the flag counted too.
        $this->actingAs($admin)
            ->getJson('/api/v1/notifications')
            ->assertOk()
            ->assertJsonPath('meta.smart', 1);
    }

    public function test_an_unknown_filter_is_rejected(): void
    {
        $this->actingAs($this->admin())
            ->getJson('/api/v1/notifications?filter=bogus')
            ->assertStatus(422);
    }
}
