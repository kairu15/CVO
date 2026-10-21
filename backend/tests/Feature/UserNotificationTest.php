<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\MonitoringRecord;
use App\Models\User;
use App\Models\UserNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Stored event notifications: every important action writes a row for its
 * recipients, the bell badge counts unread rows, and mark-all-read clears
 * them. The derived vaccination/dispersal alerts are covered by
 * NotificationTest; this is the stored half.
 */
class UserNotificationTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    /** The recipient's stored notifications, as the feed exposes them. */
    private function events(User $user): array
    {
        return collect($this->actingAs($user)
            ->getJson('/api/v1/notifications')
            ->assertOk()
            ->json('data'))
            ->filter(fn (array $alert) => str_starts_with((string) $alert['id'], 'event-'))
            ->values()
            ->all();
    }

    /** Enroll a household through the real admin endpoint. */
    private function addBeneficiary(User $actor, ?string $name = null): Beneficiary
    {
        $name ??= 'Nena Farmer '.uniqid();

        $this->actingAs($actor)
            ->postJson('/api/v1/beneficiaries', [
                'name_of_farmer' => $name,
                'address' => 'Ali-is',
                'animal_type' => 'Goat',
                'sex' => 'F',
            ])->assertCreated();

        return Beneficiary::where('name_of_farmer', $name)->firstOrFail();
    }

    public function test_adding_a_beneficiary_notifies_the_other_admins(): void
    {
        $actor = $this->admin();
        $first = $this->admin();
        $second = $this->admin();

        $this->addBeneficiary($actor, 'Nena Farmer');

        foreach ([$first, $second] as $admin) {
            $events = $this->events($admin->fresh());

            $this->assertCount(1, $events);
            $this->assertSame('beneficiary-added', $events[0]['type']);
            $this->assertSame('Beneficiary added', $events[0]['title']);
            $this->assertStringContainsString('Nena Farmer', $events[0]['message']);
            $this->assertFalse($events[0]['read']);
        }

        // The acting admin does NOT hear about their own action.
        $this->assertCount(0, $this->events($actor->fresh()));
    }

    public function test_assignment_notifies_the_technician(): void
    {
        $admin = $this->admin();
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->create();

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/beneficiaries/{$beneficiary->id}/assign-technician", [
                'technician_id' => $technician->id,
            ])
            ->assertOk();

        $techEvents = $this->events($technician->fresh());
        $this->assertSame('technician-assigned', $techEvents[0]['type']);
        $this->assertStringContainsString($beneficiary->name_of_farmer, $techEvents[0]['message']);
    }

    public function test_a_reassignment_notifies_both_technicians(): void
    {
        $admin = $this->admin();
        $first = User::factory()->create(['role' => 'technician']);
        $second = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($first)->create();

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/beneficiaries/{$beneficiary->id}/assign-technician", [
                'technician_id' => $second->id,
            ])
            ->assertOk();

        $inEvents = $this->events($second->fresh());
        $this->assertSame('technician-reassigned', $inEvents[0]['type']);
        $this->assertSame('Farmer reassigned to you', $inEvents[0]['title']);

        $outEvents = $this->events($first->fresh());
        $this->assertSame('technician-reassigned', $outEvents[0]['type']);
        $this->assertSame('Farmer reassigned away from you', $outEvents[0]['title']);
    }

    public function test_a_field_visit_photo_notifies_admins_and_doctors(): void
    {
        Storage::fake('public');

        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();
        $visit = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create();
        $admin = $this->admin();
        $doctor = User::factory()->create(['role' => 'doctor']);

        $this->actingAs($technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", [
                'image' => UploadedFile::fake()->image('shot.jpg'),
                'capture_date' => '2026-09-26',
                'capture_time' => '10:00:00',
                'timezone_offset' => 'UTC+08:00',
                'capture_year' => 2026,
                'capture_month' => 9,
                'capture_day' => 26,
                'capture_hour' => 10,
                'capture_minute' => 0,
                'capture_second' => 0,
                'location_source' => 'none',
            ])->assertCreated();

        foreach ([$admin, $doctor] as $supervisor) {
            $events = $this->events($supervisor->fresh());
            $this->assertSame('field-visit-photo', $events[0]['type']);
            $this->assertStringContainsString($technician->name, $events[0]['message']);
            $this->assertStringContainsString($beneficiary->name_of_farmer, $events[0]['message']);
        }
    }

    public function test_doctors_receive_only_the_health_relevant_events(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor']);

        // Adding a beneficiary is an admin-workflow event, not a veterinary
        // one — doctors never hear about it.
        $this->addBeneficiary($this->admin(), 'Nena Farmer');

        $this->actingAs($doctor)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.unread', 0);
    }

    public function test_unread_count_and_mark_all_read(): void
    {
        $actor = $this->admin(); // enrolls; does not notify themselves
        $receiver = $this->admin(); // exists before the events, so it receives them

        // Three events land (three households enrolled).
        foreach (range(1, 3) as $ignored) {
            $this->addBeneficiary($actor, 'Farmer '.$ignored);
        }

        $this->actingAs($receiver)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.unread', 3);

        // Mark all read → count drops to zero without waiting for a poll.
        $this->actingAs($receiver)->postJson('/api/v1/notifications/read-all')
            ->assertOk()
            ->assertJsonPath('data.marked', 3);

        $this->actingAs($receiver)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.unread', 0);

        // The actor never received their own events, so nothing to clear.
        $this->actingAs($actor)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.unread', 0);
    }

    public function test_read_all_requires_authentication_and_events_carry_read_state(): void
    {
        $this->postJson('/api/v1/notifications/read-all')->assertUnauthorized();
        $this->postJson('/api/v1/notifications/1/read')->assertUnauthorized();
        $this->getJson('/api/v1/notifications/unread-count')->assertUnauthorized();

        $admin = $this->admin();
        $beneficiary = Beneficiary::factory()->create();
        UserNotification::create([
            'user_id' => $admin->id,
            'type' => 'beneficiary-added',
            'title' => 'Beneficiary added',
            'message' => 'Test event',
            'read_at' => now(),
        ]);

        $events = $this->events($admin);
        $this->assertTrue($events[0]['read']);
    }

    public function test_the_feed_counts_stay_honest_with_events_merged_in(): void
    {
        // The limit caps rows but never the counts, events included.
        $actor = $this->admin();
        $receiver = $this->admin();

        foreach (range(1, 2) as $ignored) {
            $this->addBeneficiary($actor, 'Farmer '.$ignored);
        }

        $this->actingAs($receiver)->getJson('/api/v1/notifications?limit=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.unread_events', 2);
    }

    public function test_opening_one_notification_marks_only_that_one_read(): void
    {
        $actor = $this->admin(); // enrolls
        $receiver = $this->admin(); // exists before the events, so it receives them
        $stranger = User::factory()->create(['role' => 'doctor']); // a role the event never reaches

        foreach (range(1, 2) as $ignored) {
            $this->addBeneficiary($actor, 'Farmer '.$ignored);
        }

        $events = $this->events($receiver->fresh());
        $this->assertCount(2, $events);

        $id = (int) str_replace('event-', '', $events[0]['id']);

        $this->actingAs($receiver)->postJson("/api/v1/notifications/{$id}/read")
            ->assertOk()
            ->assertJsonPath('data.marked', true);

        // Opening one leaves the other unread — the badge counts the remainder,
        // it does not clear wholesale.
        $this->actingAs($receiver)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.unread', 1);

        // ...and the read flag is written on the row the reader opened.
        $opened = collect($this->events($receiver))->firstWhere('id', $events[0]['id']);
        $this->assertTrue($opened['read']);

        // Scoped to its owner: the same id changes nothing for another user,
        // who has no such notification at all.
        $this->actingAs($stranger)->postJson("/api/v1/notifications/{$id}/read")
            ->assertOk()
            ->assertJsonPath('data.marked', false);

        $this->actingAs($stranger)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.unread', 0);
    }
}
