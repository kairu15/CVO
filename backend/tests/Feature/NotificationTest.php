<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationTest extends TestCase
{
    use RefreshDatabase;

    private int $interval;

    private int $window;

    protected function setUp(): void
    {
        parent::setUp();

        $this->interval = (int) config('cvo.vaccination_interval_days');
        $this->window = (int) config('cvo.vaccination_due_soon_days');
    }

    /** The role whose feed is scoped to assigned households. */
    private function technician(): User
    {
        return User::factory()->create(['role' => 'technician']);
    }

    /** A beneficiary of this technician whose last vaccination was $daysAgo ago. */
    private function vaccinatedDaysAgo(User $tech, int $daysAgo): Beneficiary
    {
        $beneficiary = Beneficiary::factory()->assignedTo($tech)->create();

        MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->create(['vaccination_date' => now()->subDays($daysAgo)->toDateString()]);

        return $beneficiary;
    }

    /** @return list<array<string, mixed>> */
    private function alerts(User $user): array
    {
        return $this->actingAs($user)
            ->getJson('/api/v1/notifications')
            ->assertOk()
            ->json('data');
    }

    /** @return list<string> */
    private function types(User $user): array
    {
        return array_column($this->alerts($user), 'type');
    }

    public function test_a_guest_cannot_read_the_feed(): void
    {
        $this->getJson('/api/v1/notifications')->assertUnauthorized();
    }

    public function test_a_new_technician_with_no_records_gets_an_empty_feed(): void
    {
        // Not an error, and not silent either: the counts still come back so
        // the bell can render "nothing to show" without special-casing a 404.
        $this->actingAs($this->technician())
            ->getJson('/api/v1/notifications')
            ->assertOk()
            ->assertJsonPath('data', [])
            ->assertJsonPath('meta.total', 0)
            ->assertJsonPath('meta.urgent', 0)
            ->assertJsonPath('meta.truncated', false);
    }

    public function test_an_overdue_vaccination_raises_an_urgent_alert(): void
    {
        $tech = $this->technician();
        $animal = $this->vaccinatedDaysAgo($tech, $this->interval + 32);

        $response = $this->actingAs($tech)->getJson('/api/v1/notifications');

        $response->assertOk()
            ->assertJsonPath('data.0.type', 'vaccination-overdue')
            ->assertJsonPath('data.0.urgency', 'urgent')
            ->assertJsonPath('data.0.title', 'Vaccination overdue')
            ->assertJsonPath('data.0.beneficiary_id', $animal->id)
            ->assertJsonPath('data.0.days_until_due', -32)
            // The due date is the alert's date, so the row can render it with
            // the same formatter as every other screen.
            ->assertJsonPath('data.0.date', now()->subDays($this->interval + 32)->addDays($this->interval)->toDateString())
            ->assertJsonPath('meta.urgent', 1);
    }

    public function test_an_animal_with_no_vaccination_raises_no_alert(): void
    {
        // A standing state, not an event: true of every animal from the day it
        // is registered, so alerting on it would fire for the whole program at
        // once. The schedule and the health rollup report it instead — both
        // list never-vaccinated animals first.
        $tech = $this->technician();
        Beneficiary::factory()->assignedTo($tech)->create();

        $this->actingAs($tech)
            ->getJson('/api/v1/notifications')
            ->assertOk()
            ->assertJsonPath('data', [])
            ->assertJsonPath('meta.urgent', 0);

        // Same animal, still visible on the schedule — the fact is not lost,
        // it just is not a notification.
        $this->actingAs($tech)
            ->getJson('/api/v1/vaccination-schedule')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'never');
    }

    public function test_a_vaccination_coming_due_is_a_warning(): void
    {
        $tech = $this->technician();
        // Interval minus half the warning window: inside "due soon", not past.
        $this->vaccinatedDaysAgo($tech, $this->interval - (int) ($this->window / 2));

        $response = $this->actingAs($tech)->getJson('/api/v1/notifications');

        $response->assertOk()
            ->assertJsonPath('data.0.type', 'vaccination-due-soon')
            ->assertJsonPath('data.0.urgency', 'warning')
            ->assertJsonPath('meta.warning', 1)
            ->assertJsonPath('meta.urgent', 0);
    }

    public function test_a_vaccination_far_from_due_raises_no_alert(): void
    {
        // The feed is for what needs attention, not a restatement of the whole
        // schedule: an animal due in six months is not a notification.
        $tech = $this->technician();
        $this->vaccinatedDaysAgo($tech, 1);

        $this->actingAs($tech)
            ->getJson('/api/v1/notifications')
            ->assertOk()
            ->assertJsonPath('data', [])
            ->assertJsonPath('meta.total', 0);
    }

    public function test_a_dispersal_to_an_assigned_animal_raises_an_alert(): void
    {
        $tech = $this->technician();
        $animal = Beneficiary::factory()->assignedTo($tech)->create(['animal_type' => 'Carabao', 'sex' => 'F']);

        DispersalEvent::factory()->initial($animal)->create([
            'date_dispersed' => now()->subDays(9)->toDateString(),
        ]);

        $response = $this->actingAs($tech)->getJson('/api/v1/notifications');

        $response->assertOk()
            ->assertJsonPath('data.0.type', 'dispersal')
            ->assertJsonPath('data.0.urgency', 'info')
            ->assertJsonPath('data.0.title', 'Animal dispersed')
            ->assertJsonPath('data.0.date', now()->subDays(9)->toDateString())
            // The programme released the animal, so there is no source household.
            ->assertJsonPath('data.0.message', "Carabao (F) was released to {$animal->name_of_farmer} in {$animal->address}.");
    }

    public function test_a_re_dispersal_of_an_offspring_raises_an_alert(): void
    {
        $tech = $this->technician();
        $parent = Beneficiary::factory()->assignedTo($tech)->create(['animal_type' => 'Carabao', 'sex' => 'F']);
        $recipient = Beneficiary::factory()->create(['animal_type' => 'Carabao', 'sex' => 'M']);

        DispersalEvent::factory()->reDispersal($recipient, $parent)->create([
            'date_dispersed' => now()->subDays(3)->toDateString(),
        ]);

        $response = $this->actingAs($tech)->getJson('/api/v1/notifications');

        $response->assertOk()
            ->assertJsonPath('data.0.type', 're-dispersal')
            ->assertJsonPath('data.0.title', 'Re-dispersal recorded')
            ->assertJsonPath('data.0.message', "Carabao (M) from {$parent->name_of_farmer} in {$parent->address} went to {$recipient->name_of_farmer} in {$recipient->address}.");
    }

    public function test_alerts_are_worded_from_the_record_not_the_reader(): void
    {
        // The same alert is read by the technician whose assignment it is and
        // by an all-access admin. "You received an animal" would be false for
        // one of them, so the wording never addresses the reader.
        $tech = $this->technician();
        $animal = Beneficiary::factory()->assignedTo($tech)->create();

        DispersalEvent::factory()->initial($animal)->create();

        MonitoringRecord::factory()
            ->for($animal, 'beneficiary')
            ->create(['vaccination_date' => now()->subDays($this->interval + 5)->toDateString()]);

        foreach ($this->alerts($tech) as $alert) {
            $this->assertStringNotContainsString(' you', strtolower($alert['message']));
            $this->assertStringNotContainsString('your', strtolower($alert['message']));
        }

        $this->assertNotEmpty($this->alerts($tech));
    }

    public function test_urgency_bands_order_the_feed_with_overdue_first(): void
    {
        $tech = $this->technician();
        $animal = Beneficiary::factory()->assignedTo($tech)->create();

        DispersalEvent::factory()->initial($animal)->create(['date_dispersed' => now()->toDateString()]);
        $this->vaccinatedDaysAgo($tech, $this->interval - (int) ($this->window / 2)); // warning
        $this->vaccinatedDaysAgo($tech, $this->interval + 2); // urgent
        $this->vaccinatedDaysAgo($tech, $this->interval + 40); // urgent, worse

        $alerts = $this->alerts($tech);

        // Urgent first, then warning, then the informational movement — even
        // though the movement is the most recent thing that happened.
        $this->assertSame(
            ['urgent', 'urgent', 'warning', 'info'],
            array_column($alerts, 'urgency'),
        );

        // Inside the urgent band, most overdue leads — the same worst-first
        // order the vaccination schedule uses, rather than plain recency.
        $overdue = array_values(array_filter($alerts, fn (array $a) => $a['type'] === 'vaccination-overdue'));
        $this->assertSame([-40, -2], array_column($overdue, 'days_until_due'));
    }

    public function test_the_feed_only_covers_the_callers_assigned_animals(): void
    {
        $tech = $this->technician();
        $other = $this->technician();

        $mine = Beneficiary::factory()->assignedTo($tech)->create();
        $theirs = Beneficiary::factory()->assignedTo($other)->create();

        DispersalEvent::factory()->initial($mine)->create();
        DispersalEvent::factory()->initial($theirs)->create();
        $this->vaccinatedDaysAgo($other, $this->interval + 10);

        $alerts = $this->alerts($tech);

        $this->assertSame([$mine->id], array_unique(array_column($alerts, 'beneficiary_id')));
    }

    public function test_staff_see_the_feed_for_everything_they_can_see(): void
    {
        // A technician's feed follows the same scoping as their beneficiary
        // list: only animals assigned to them.
        $technician = User::factory()->create(['role' => 'technician']);
        $mine = Beneficiary::factory()->assignedTo($technician)->create();
        $unassigned = Beneficiary::factory()->create();

        DispersalEvent::factory()->initial($mine)->create();
        DispersalEvent::factory()->initial($unassigned)->create();

        $alerts = $this->alerts($technician);

        $this->assertCount(1, $alerts);
        $this->assertSame([$mine->id], array_unique(array_column($alerts, 'beneficiary_id')));
    }

    public function test_an_admin_sees_an_alert_for_every_animal(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $first = Beneficiary::factory()->create();
        $second = Beneficiary::factory()->create();

        DispersalEvent::factory()->initial($first)->create();
        DispersalEvent::factory()->initial($second)->create();

        $alerts = $this->alerts($admin);

        $this->assertCount(2, $alerts);
    }

    public function test_alerts_link_to_the_page_that_owns_the_record_for_that_role(): void
    {
        $tech = $this->technician();
        $animal = Beneficiary::factory()->assignedTo($tech)->create();

        DispersalEvent::factory()->initial($animal)->create();
        MonitoringRecord::factory()
            ->for($animal, 'beneficiary')
            ->create(['vaccination_date' => now()->subDays($this->interval + 1)->toDateString()]);

        $byType = collect($this->alerts($tech))->keyBy('type');

        // Movements live on the technician's dispersal map; vaccinations on
        // the monitoring table that owns the record.
        $this->assertSame('/dashboard/technician/map', $byType['dispersal']['link']);
        $this->assertSame('/dashboard/technician/monitoring', $byType['vaccination-overdue']['link']);

        // An admin reads every movement, on their own map.
        $admin = User::factory()->create(['role' => 'admin']);
        $assigned = Beneficiary::factory()->assignedTo($tech)->create();
        DispersalEvent::factory()->initial($assigned)->create();

        $adminAlerts = collect($this->alerts($admin))->where('type', 'dispersal');

        $this->assertCount(2, $adminAlerts);
        $this->assertSame(
            ['/dashboard/admin/map', '/dashboard/admin/map'],
            $adminAlerts->pluck('link')->values()->all(),
        );
    }

    public function test_an_alert_id_is_stable_for_the_same_record(): void
    {
        // Both presentations of the feed read the same ids, so the bell and the
        // page cannot disagree about which alert is which.
        $tech = $this->technician();
        $animal = $this->vaccinatedDaysAgo($tech, $this->interval + 5);

        $first = $this->alerts($tech);
        $second = $this->alerts($tech);

        $this->assertSame($first[0]['id'], $second[0]['id']);
        $this->assertSame("vaccination-overdue-{$animal->id}", $first[0]['id']);
    }

    public function test_the_limit_caps_the_rows_but_not_the_counts(): void
    {
        // A truncated page must still report how much is behind it, or the
        // badge would understate what needs attention.
        $tech = $this->technician();

        foreach (range(1, 3) as $ignored) {
            $this->vaccinatedDaysAgo($tech, $this->interval + 7);
        }

        $response = $this->actingAs($tech)->getJson('/api/v1/notifications?limit=1');

        $response->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.urgent', 3);
    }

    public function test_the_limit_is_bounded(): void
    {
        $tech = $this->technician();

        $this->actingAs($tech)->getJson('/api/v1/notifications?limit=0')->assertInvalid(['limit']);
        $this->actingAs($tech)->getJson('/api/v1/notifications?limit=abc')->assertInvalid(['limit']);

        // An over-limit page size is clamped to the system-wide 50, not
        // rejected, so an older caller keeps getting a full page.
        $this->actingAs($tech)
            ->getJson('/api/v1/notifications?limit=500')
            ->assertOk()
            ->assertJsonPath('meta.per_page', 50);
    }

    public function test_the_feed_is_read_only(): void
    {
        // Nothing to mark as read: the alert resolves when the record it
        // describes is recorded, and there is no table to write to.
        $tech = $this->technician();

        $this->actingAs($tech)->postJson('/api/v1/notifications', [])->assertMethodNotAllowed();
        $this->actingAs($tech)->patchJson('/api/v1/notifications', [])->assertMethodNotAllowed();
        $this->actingAs($tech)->deleteJson('/api/v1/notifications')->assertMethodNotAllowed();
    }

    public function test_the_feed_carries_no_read_state(): void
    {
        // Guards the decision, not just the implementation: a `read_at` here
        // would mean a stored feed, which is exactly what this module avoided.
        $tech = $this->technician();
        $this->vaccinatedDaysAgo($tech, $this->interval + 3);

        $alert = $this->alerts($tech)[0];

        $this->assertArrayNotHasKey('read_at', $alert);
        $this->assertArrayNotHasKey('read', $alert);
        $this->assertArrayNotHasKey('unread', $alert);
    }
}
