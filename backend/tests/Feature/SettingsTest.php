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
        $this->assertSame(config('cvo.barangays'), $data['barangays']);
        $this->assertSame(config('cvo.health_outcomes'), $data['vocabulary']['health_outcomes']);
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

        Cache::forget('settings.office_profile');

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
        $this->actingAs($this->admin())
            ->patchJson('/api/v1/admin/settings', [
                'office_phone' => '(035) 555-0100',
                'vaccination_interval_days' => 1, // not a settings-table key
            ])
            ->assertOk();

        $this->assertDatabaseMissing('settings', ['key' => 'vaccination_interval_days']);
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
}
