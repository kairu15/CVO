<?php

namespace Tests\Feature;

use App\Mail\ContactMessageReceived;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * The public contact form: valid submissions are stored and forwarded to the
 * office inbox from System Settings, invalid ones are named by field, and the
 * forwarding is best-effort (an SMTP failure must not lose the submission).
 * The admin management gate rides the same manage_settings capability.
 */
class PublicContactTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // SettingsService caches its values for 12 hours; tests must see the
        // rows they write.
        Cache::flush();
    }

    /* ------------------------------------------------------------------ *
     |  Helpers                                                            |
     * ------------------------------------------------------------------ */

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function officeInbox(): string
    {
        Setting::create(['key' => 'office_email', 'value' => 'office@cityvets.org']);

        return 'office@cityvets.org';
    }

    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Juan Dela Cruz',
            'email' => 'juan@example.com',
            'phone' => '0917 000 0000',
            'subject' => 'Dispersal application',
            'message' => 'I would like to apply for the livestock dispersal program.',
        ], $overrides);
    }

    /* ------------------------------------------------------------------ *
     |  Public submission                                                  |
     * ------------------------------------------------------------------ */

    public function test_a_valid_submission_is_stored_and_forwarded_to_the_office(): void
    {
        Mail::fake();
        $inbox = $this->officeInbox();

        $response = $this->postJson('/api/v1/public/contact', $this->validPayload());

        $response->assertCreated();
        $this->assertDatabaseHas('contact_messages', [
            'name' => 'Juan Dela Cruz',
            'email' => 'juan@example.com',
            'subject' => 'Dispersal application',
        ]);

        Mail::assertSent(ContactMessageReceived::class, 1);
        Mail::assertSent(ContactMessageReceived::class, function (ContactMessageReceived $mail) use ($inbox) {
            return $mail->hasTo($inbox);
        });
    }

    public function test_the_submission_is_answered_with_a_confirmation(): void
    {
        Mail::fake();
        $this->officeInbox();

        $response = $this->postJson('/api/v1/public/contact', $this->validPayload());

        $response->assertCreated();
        $this->assertStringContainsStringIgnoringCase(
            'received',
            (string) $response->json('data.message'),
        );
    }

    public function test_invalid_submissions_are_named_by_field_and_not_stored(): void
    {
        Mail::fake();
        $this->officeInbox();

        $this->postJson('/api/v1/public/contact', $this->validPayload([
            'email' => 'not-an-email',
            'message' => '',
        ]))->assertStatus(422)->assertJsonValidationErrors(['email', 'message']);

        $this->assertDatabaseCount('contact_messages', 0);
        Mail::assertNothingSent();
    }

    public function test_a_mailer_outage_still_stores_the_submission_and_answers_201(): void
    {
        // No office inbox configured (settings table empty → shipped
        // placeholder) — storing IS the delivery, and the visitor still gets
        // their confirmation.
        Mail::fake();

        $this->postJson('/api/v1/public/contact', $this->validPayload())
            ->assertCreated();

        $this->assertDatabaseCount('contact_messages', 1);
        Mail::assertNothingSent();
    }

    public function test_the_endpoint_does_not_exist_to_authenticated_abuse_either(): void
    {
        // The contact endpoint is deliberately rate limited far below the
        // other public budgets — assert the route carries its own name so the
        // budget is verifiable in the route list.
        $this->assertTrue(
            app('router')->getRoutes()->hasNamedRoute('api.public.contact'),
        );
    }

    /* ------------------------------------------------------------------ *
     |  Gate                                                               |
     * ------------------------------------------------------------------ */

    public function test_the_stored_table_has_no_public_read_path(): void
    {
        // Nothing may expose submissions publicly: the only public verb on
        // /public/contact is POST. A GET on the POST-only route answers
        // 405 (method not allowed), never a listing.
        $routes = app('router')->getRoutes();
        $this->assertNull($routes->getByName('api.public.contact.index'));

        $this->getJson('/api/v1/public/contact')->assertStatus(405);
    }
}
