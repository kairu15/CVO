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

    public function test_registration_notifies_every_admin(): void
    {
        $first = $this->admin();
        $second = $this->admin();
        $otherAdmin = $this->admin(); // also an admin — also notified

        $this->postJson('/api/v1/register', [
            'name' => 'Nena Farmer',
            'username' => 'nena'.uniqid(),
            'email' => 'nena'.uniqid().'@test.dev',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'address' => 'Ali-is',
            'animal_type' => 'Goat',
            'sex' => 'F',
        ])->assertCreated();

        foreach ([$first, $second, $otherAdmin] as $admin) {
            $events = $this->events($admin->fresh());

            $this->assertCount(1, $events);
            $this->assertSame('registration-new', $events[0]['type']);
            $this->assertSame('New farmer registered', $events[0]['title']);
            $this->assertStringContainsString('Nena Farmer', $events[0]['message']);
            $this->assertFalse($events[0]['read']);
        }
    }

    public function test_accepting_a_registration_notifies_the_farmer_and_other_admins(): void
    {
        $actor = $this->admin();
        $colleague = $this->admin();

        $this->postJson('/api/v1/register', [
            'name' => 'Nena Farmer',
            'username' => 'nena'.uniqid(),
            'email' => 'nena'.uniqid().'@test.dev',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'address' => 'Ali-is',
            'animal_type' => 'Goat',
            'sex' => 'F',
        ])->assertCreated();

        $record = MonitoringRecord::latest('id')->first();
        $farmer = User::find($record->beneficiary->farmer_id);

        $this->actingAs($actor)->patchJson("/api/v1/monitoring-records/{$record->id}/accept")->assertOk();

        // The acting admin does NOT hear about their own action.
        $this->assertCount(1, $this->events($actor->fresh())); // only the registration event

        $farmerEvents = $this->events($farmer->fresh());
        $this->assertSame('registration-accepted', $farmerEvents[0]['type']);
        $this->assertSame('Registration accepted', $farmerEvents[0]['title']);

        $colleagueEvents = $this->events($colleague->fresh());
        $this->assertSame('registration-accepted', $colleagueEvents[0]['type']);
        $this->assertStringContainsString($actor->name, $colleagueEvents[0]['message']);
    }

    public function test_assignment_notifies_the_technician_and_the_farmer(): void
    {
        $admin = $this->admin();
        $technician = User::factory()->create(['role' => 'technician']);
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->create();

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/beneficiaries/{$beneficiary->id}/assign-technician", [
                'technician_id' => $technician->id,
            ])
            ->assertOk();

        $techEvents = $this->events($technician->fresh());
        $this->assertSame('technician-assigned', $techEvents[0]['type']);
        $this->assertStringContainsString($beneficiary->name_of_farmer, $techEvents[0]['message']);

        $farmerEvents = $this->events($farmer->fresh());
        $this->assertSame('technician-assigned', $farmerEvents[0]['type']);
        $this->assertStringContainsString($technician->name, $farmerEvents[0]['message']);
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

        // A registration is an admin-workflow event, not a veterinary one.
        $this->postJson('/api/v1/register', [
            'name' => 'Nena Farmer',
            'username' => 'nena'.uniqid(),
            'email' => 'nena'.uniqid().'@test.dev',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'address' => 'Ali-is',
            'animal_type' => 'Goat',
            'sex' => 'F',
        ])->assertCreated();

        $this->actingAs($doctor)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.unread', 0);
    }

    public function test_unread_count_and_mark_all_read(): void
    {
        $admin = $this->admin();
        $other = $this->admin(); // exists before the events, so it receives them

        // Three events land (three registrations).
        foreach (range(1, 3) as $ignored) {
            $this->postJson('/api/v1/register', [
                'name' => 'Farmer '.$ignored,
                'username' => 'f'.$ignored.uniqid(),
                'email' => 'f'.$ignored.uniqid().'@test.dev',
                'password' => 'Sup3r-Secret!',
                'password_confirmation' => 'Sup3r-Secret!',
                'address' => 'Ali-is',
                'animal_type' => 'Goat',
                'sex' => 'F',
            ])->assertCreated();
        }

        $this->actingAs($admin)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.unread', 3);

        // Mark all read → count drops to zero without waiting for a poll.
        $this->actingAs($admin)->postJson('/api/v1/notifications/read-all')
            ->assertOk()
            ->assertJsonPath('data.marked', 3);

        $this->actingAs($admin)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.unread', 0);

        // Read state is per user: the other admin still has theirs.
        $this->actingAs($other)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.unread', 3);
    }

    public function test_read_all_requires_authentication_and_events_carry_read_state(): void
    {
        $this->postJson('/api/v1/notifications/read-all')->assertUnauthorized();
        $this->getJson('/api/v1/notifications/unread-count')->assertUnauthorized();

        $admin = $this->admin();
        $beneficiary = Beneficiary::factory()->create();
        UserNotification::create([
            'user_id' => $admin->id,
            'type' => 'registration-new',
            'title' => 'New farmer registered',
            'message' => 'Test event',
            'read_at' => now(),
        ]);

        $events = $this->events($admin);
        $this->assertTrue($events[0]['read']);
    }

    public function test_the_feed_counts_stay_honest_with_events_merged_in(): void
    {
        // The limit caps rows but never the counts, events included.
        $admin = $this->admin();

        foreach (range(1, 2) as $ignored) {
            $this->postJson('/api/v1/register', [
                'name' => 'Farmer '.$ignored,
                'username' => 'x'.$ignored.uniqid(),
                'email' => 'x'.$ignored.uniqid().'@test.dev',
                'password' => 'Sup3r-Secret!',
                'password_confirmation' => 'Sup3r-Secret!',
                'address' => 'Ali-is',
                'animal_type' => 'Goat',
                'sex' => 'F',
            ])->assertCreated();
        }

        $this->actingAs($admin)->getJson('/api/v1/notifications?limit=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.unread_events', 2);
    }
}
