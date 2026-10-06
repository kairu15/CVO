<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GET /api/v1/site — the public read path for the office contact details an
 * administrator edits in System Settings.
 *
 * This is the regression the settings table needed: without a session-free
 * way to read the saved profile, the landing page, the Support page and the
 * password-reset note would keep rendering the hard-coded placeholder from
 * `frontend/src/config/site.js`, and "change it from the UI, no deploy" would
 * be untrue.
 */
class SiteTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_guest_can_read_the_site_metadata(): void
    {
        $data = $this->getJson('/api/v1/site')
            ->assertOk()
            ->json('data');

        $this->assertSame(config('cvo.office.email'), $data['office']['office_email']);
        $this->assertSame(config('cvo.office.phone'), $data['office']['office_phone']);
        $this->assertSame(config('security.client_idle_minutes'), $data['session']['idle_minutes']);
    }

    public function test_saved_contact_details_reach_the_public_pages(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->patchJson('/api/v1/admin/settings', [
                'office_email' => 'cvo@bayawan.gov.ph',
                'office_phone' => '(035) 555-0100',
                'office_hours' => 'Monday to Friday, 8:00 AM – 5:00 PM',
                'office_address' => 'City Veterinary Office, Bayawan City',
            ])
            ->assertOk();

        // Read back with no session at all — a visitor on the landing page.
        $data = $this->getJson('/api/v1/site')
            ->assertOk()
            ->json('data.office');

        $this->assertSame('cvo@bayawan.gov.ph', $data['office_email']);
        $this->assertSame('(035) 555-0100', $data['office_phone']);
        $this->assertSame('City Veterinary Office, Bayawan City', $data['office_address']);
    }

    public function test_the_saved_inactivity_window_reaches_the_client(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->patchJson('/api/v1/admin/settings', ['session_idle_minutes' => 20])
            ->assertOk();

        $this->getJson('/api/v1/site')
            ->assertOk()
            ->assertJsonPath('data.session.idle_minutes', 20);
    }

    public function test_the_public_payload_stays_within_its_boundary(): void
    {
        $data = $this->getJson('/api/v1/site')->assertOk()->json('data');

        // Office contact and the client-side window — nothing else. The
        // server's real session lifetimes, the barangay list and the form
        // vocabularies stay on the admin-only payload.
        $this->assertSame(['office', 'session'], array_keys($data));
        $this->assertSame(['idle_minutes'], array_keys($data['session']));
        $this->assertSame(
            ['office_email', 'office_phone', 'office_hours', 'office_address'],
            array_keys($data['office']),
        );
    }
}
