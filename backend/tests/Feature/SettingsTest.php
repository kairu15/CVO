<?php

namespace Tests\Feature;

use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class SettingsTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    public function test_a_guest_cannot_read_settings(): void
    {
        $this->getJson('/api/v1/admin/settings')->assertUnauthorized();
    }

    public function test_only_admins_can_read_settings(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'farmer']))
            ->getJson('/api/v1/admin/settings')
            ->assertForbidden();
    }

    public function test_only_admins_can_change_settings(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'technician']))
            ->patchJson('/api/v1/admin/settings', ['office_phone' => '123'])
            ->assertForbidden();
    }

    public function test_settings_return_the_configured_defaults_before_any_save(): void
    {
        $data = $this->actingAs($this->admin())
            ->getJson('/api/v1/admin/settings')
            ->assertOk()
            ->json('data');

        $this->assertSame(config('cvo.office.phone'), $data['office_profile']['office_phone']);
        // Reference data rides along with ids + puroks so the page can manage
        // it through the dedicated /admin/barangays endpoints. The payload is
        // DB-driven (like the public cascade); its shape is covered in
        // BarangayManagementTest.
        $this->assertIsList($data['barangays']);
        $this->assertSame(config('cvo.animal_types'), $data['animal_types']);
        $this->assertSame(config('cvo.health_outcomes'), $data['health_outcomes']);
        $this->assertSame(config('cvo.field_visit_purposes'), $data['field_visit_purposes']);
    }

    public function test_an_admin_can_save_the_office_profile(): void
    {
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', [
                'office_phone' => '(035) 555-0100',
                'office_email' => 'office@bayawan.gov.ph',
            ])
            ->assertOk()
            ->assertJsonPath('data.office_profile.office_phone', '(035) 555-0100');

        $this->assertDatabaseHas('settings', ['key' => 'office_phone', 'value' => '(035) 555-0100']);
        // Keys not sent are untouched, not blanked.
        $this->assertDatabaseMissing('settings', ['key' => 'office_hours']);
    }

    public function test_a_saved_profile_survives_a_config_default_change(): void
    {
        Setting::create(['key' => 'office_phone', 'value' => '(035) 555-0100']);

        // The stored value is the office's own edit — it must win over the
        // shipped placeholder even though the fallback comes from config.
        config(['cvo.office.phone' => '(035) 000-9999']);

        Cache::forget('settings.values');

        $this->actingAs($this->admin())
            ->getJson('/api/v1/admin/settings')
            ->assertOk()
            ->assertJsonPath('data.office_profile.office_phone', '(035) 555-0100');
    }

    public function test_the_barangay_list_cannot_be_overwritten(): void
    {
        // Rejected outright rather than silently dropped: a payload carrying
        // the key is a client bug, and hiding it would invite the bug to ship.
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', [
                'barangays' => ['One Barangay Only'],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['barangays']);

        // Nothing was stored: the list remains config-owned, not data.
        $this->assertDatabaseMissing('settings', ['key' => 'barangays']);
    }

    public function test_an_invalid_email_is_rejected(): void
    {
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['office_email' => 'not-an-email'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['office_email']);
    }

    public function test_an_unknown_key_is_ignored(): void
    {
        // The smart-alert thresholds are still config-owned (they are clinical
        // decisions, some of them explicitly unconfirmed), so the settings
        // endpoint must not start storing them just because it now stores
        // other numeric keys.
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', [
                'office_phone' => '(035) 555-0100',
                'bcs_normal_range' => [2, 4], // not a settings-table key
            ])
            ->assertOk();

        $this->assertDatabaseMissing('settings', ['key' => 'bcs_normal_range']);
    }

    public function test_settings_return_the_configured_vaccination_cycle_before_any_save(): void
    {
        $data = $this->actingAs($this->admin())
            ->getJson('/api/v1/admin/settings')
            ->assertOk()
            ->json('data');

        $this->assertSame(config('cvo.vaccination_interval_days'), $data['alerts']['vaccination_interval_days']);
        $this->assertSame(config('cvo.vaccination_due_soon_days'), $data['alerts']['vaccination_due_soon_days']);
        $this->assertSame(config('security.client_idle_minutes'), $data['session']['idle_minutes']);
    }

    public function test_an_admin_can_save_the_vaccination_thresholds(): void
    {
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', [
                'vaccination_interval_days' => 90,
                'vaccination_due_soon_days' => 14,
            ])
            ->assertOk()
            // Returned as numbers, not the strings the table stores — the
            // settings screen renders them back into number inputs.
            ->assertJsonPath('data.alerts.vaccination_interval_days', 90)
            ->assertJsonPath('data.alerts.vaccination_due_soon_days', 14);

        $this->assertDatabaseHas('settings', ['key' => 'vaccination_interval_days', 'value' => '90']);
        $this->assertDatabaseHas('settings', ['key' => 'vaccination_due_soon_days', 'value' => '14']);
    }

    public function test_a_nonsensical_vaccination_threshold_is_rejected(): void
    {
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['vaccination_interval_days' => 0])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['vaccination_interval_days']);

        $this->assertDatabaseMissing('settings', ['key' => 'vaccination_interval_days']);
    }

    public function test_an_admin_can_save_the_inactivity_window(): void
    {
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['session_idle_minutes' => 25])
            ->assertOk()
            ->assertJsonPath('data.session.idle_minutes', 25);

        $this->assertDatabaseHas('settings', ['key' => 'session_idle_minutes', 'value' => '25']);
    }

    public function test_the_inactivity_window_cannot_exceed_the_servers_own_idle_limit(): void
    {
        // A longer client window would leave the user silently 401'd
        // mid-form — the exact failure IdleSessionGuard exists to prevent.
        $serverLimit = (int) config('security.session_idle');

        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['session_idle_minutes' => $serverLimit + 1])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['session_idle_minutes']);

        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['session_idle_minutes' => $serverLimit])
            ->assertOk();
    }

    public function test_the_server_session_ceilings_are_reported_read_only(): void
    {
        $data = $this->actingAs($this->admin())
            ->getJson('/api/v1/admin/settings')
            ->assertOk()
            ->json('data.session');

        $this->assertSame((int) config('security.session_idle'), $data['server_idle_minutes']);
        $this->assertSame((int) config('security.session_absolute'), $data['server_absolute_minutes']);
    }

    public function test_a_read_hits_the_cache_and_a_write_drops_it(): void
    {
        // Warm the cache with one phone number...
        $this->actingAs($this->admin())
            ->getJson('/api/v1/admin/settings')
            ->assertOk();

        // ...then change it behind the cache's back.
        Setting::create(['key' => 'office_phone', 'value' => '(035) 555-0100']);

        $stale = $this->actingAs($this->admin())
            ->getJson('/api/v1/admin/settings')
            ->assertOk()
            ->json('data.office_profile.office_phone');
        $this->assertSame(config('cvo.office.phone'), $stale);

        // A write forgets the cache, so the next read is fresh.
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['office_hours' => 'Mon–Fri'])
            ->assertOk();

        $this->actingAs($this->admin())
            ->getJson('/api/v1/admin/settings')
            ->assertOk()
            ->assertJsonPath('data.office_profile.office_phone', '(035) 555-0100');
    }

    public function test_an_admin_can_save_the_field_visit_overdue_threshold(): void
    {
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['field_visit_overdue_days' => 45])
            ->assertOk()
            ->assertJsonPath('data.alerts.field_visit_overdue_days', 45);

        // The smart-alert scan reads the saved value, not config.
        $this->assertSame(45, app(\App\Services\SettingsService::class)->fieldVisitOverdueDays());
    }

    public function test_a_nonsensical_field_visit_threshold_is_rejected(): void
    {
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['field_visit_overdue_days' => 0])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['field_visit_overdue_days']);
    }

    public function test_an_admin_can_save_the_animal_type_list(): void
    {
        $list = ['Carabao', 'Cattle', 'Chicken'];

        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['animal_types' => $list])
            ->assertOk()
            ->assertJsonPath('data.animal_types', $list);

        // The importer's casing vocabulary now comes from the saved list.
        $this->assertSame($list, \App\Support\AnimalTypes::suggested());
        $this->assertSame('Chicken', \App\Support\AnimalTypes::normalize('CHICKEN'));
    }

    public function test_an_invalid_animal_type_list_is_rejected(): void
    {
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['animal_types' => ['Goat', '']])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['animal_types.1']);
    }

    public function test_an_admin_can_save_the_health_outcome_vocabulary(): void
    {
        $list = ['recovered', 'ongoing', 'under treatment'];

        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['health_outcomes' => $list])
            ->assertOk()
            ->assertJsonPath('data.health_outcomes', $list);

        // The saved list is now the vocabulary every consumer reads.
        $this->assertSame($list, app(\App\Services\SettingsService::class)->healthOutcomes());
    }

    public function test_an_admin_can_save_the_field_visit_purpose_vocabulary(): void
    {
        $list = ['routine-monitoring', 'emergency'];

        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['field_visit_purposes' => $list])
            ->assertOk()
            ->assertJsonPath('data.field_visit_purposes', $list);

        $this->assertSame($list, app(\App\Services\SettingsService::class)->fieldVisitPurposes());
    }

    public function test_an_invalid_vocabulary_list_is_rejected(): void
    {
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['health_outcomes' => ['recovered', '']])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['health_outcomes.1']);

        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', [
                'field_visit_purposes' => ['routine-monitoring', 'routine-monitoring'],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['field_visit_purposes.1']);
    }

    public function test_notification_preferences_default_to_everything_on(): void
    {
        $data = $this->actingAs($this->admin())
            ->getJson('/api/v1/admin/settings')
            ->assertOk()
            ->json('data.notifications');

        $this->assertSame(['registration-new', 'registration-accepted', 'technician-assigned', 'technician-reassigned', 'field-visit-photo', 'smart-vaccination-overdue', 'smart-bcs-out-of-range', 'smart-no-recent-visit', 'smart-barangay-flag'], array_keys($data));
        $this->assertNotContains(false, $data);
    }

    public function test_a_disabled_event_type_writes_no_notification(): void
    {
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', ['notify_technician_assigned' => false])
            ->assertOk();

        $service = app(\App\Services\NotificationService::class);

        $recipient = User::factory()->create(['role' => 'technician']);

        $suppressed = $service->create($recipient, [
            'type' => 'technician-assigned',
            'title' => 'Should not exist',
            'message' => 'Suppressed by preference',
        ]);
        $this->assertNull($suppressed);
        $this->assertDatabaseMissing('user_notifications', ['type' => 'technician-assigned']);

        // Other types still write.
        $service->create($recipient, [
            'type' => 'registration-accepted',
            'title' => 'Still writes',
            'message' => 'Not suppressed',
        ]);
        $this->assertDatabaseHas('user_notifications', ['type' => 'registration-accepted']);
    }
}
