<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\User;
use App\Models\UserNotification;
use App\Services\NotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationManagementTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function notification(User $user, array $attributes = []): UserNotification
    {
        return UserNotification::create([
            'user_id' => $user->id,
            'type' => UserNotification::TYPE_BENEFICIARY_ADDED,
            'category' => UserNotification::CATEGORY_BENEFICIARIES,
            'priority' => UserNotification::PRIORITY_NORMAL,
            'title' => 'Beneficiary added',
            'message' => 'Maria Santos was added to the program.',
            ...$attributes,
        ]);
    }

    public function test_the_feed_filters_stored_notifications_before_returning_rows(): void
    {
        $admin = $this->admin();

        $this->notification($admin, [
            'title' => 'Beneficiary added',
            'message' => 'Maria Santos was added.',
        ]);
        $this->notification($admin, [
            'type' => UserNotification::TYPE_ANIMAL_DISPERSED,
            'category' => UserNotification::CATEGORY_DISPERSALS,
            'title' => 'Animal dispersed',
            'message' => 'Carabao moved to Juan Cruz.',
        ]);
        $this->notification($admin, [
            'type' => UserNotification::TYPE_SMART_VACCINATION_OVERDUE,
            'category' => UserNotification::CATEGORY_MONITORING,
            'priority' => UserNotification::PRIORITY_CRITICAL,
            'title' => 'Vaccination overdue',
            'message' => 'A carabao passed its due date.',
        ]);

        $response = $this->actingAs($admin)->getJson(
            '/api/v1/notifications?status=unread&category=beneficiaries&priority=normal&search=Maria',
        );

        $response->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.title', 'Beneficiary added')
            ->assertJsonPath('data.0.category', 'beneficiaries')
            ->assertJsonPath('data.0.priority', 'normal');
    }

    public function test_bulk_actions_only_touch_the_callers_own_rows(): void
    {
        $admin = $this->admin();
        $stranger = $this->admin();

        $mine = $this->notification($admin);
        $theirs = $this->notification($stranger);

        $this->actingAs($admin)
            ->postJson('/api/v1/notifications/bulk', [
                'ids' => [$mine->id, $theirs->id],
                'action' => 'archive',
            ])
            ->assertOk()
            ->assertJsonPath('data.changed', 1);

        $this->assertNotNull($mine->fresh()->archived_at);
        $this->assertNull($theirs->fresh()->archived_at);

        $this->actingAs($admin)
            ->postJson('/api/v1/notifications/bulk', [
                'ids' => [$mine->id],
                'action' => 'delete',
            ])
            ->assertOk()
            ->assertJsonPath('data.changed', 1);

        $this->assertDatabaseMissing('user_notifications', ['id' => $mine->id]);
        $this->assertDatabaseHas('user_notifications', ['id' => $theirs->id]);
    }

    public function test_per_user_preferences_suppress_a_category_and_can_be_read_back(): void
    {
        $admin = $this->admin();
        $service = app(NotificationService::class);

        $this->actingAs($admin)
            ->patchJson('/api/v1/notifications/preferences', [
                'preferences' => [UserNotification::CATEGORY_BENEFICIARIES => false],
            ])
            ->assertOk()
            ->assertJsonPath('data.preferences.beneficiaries', false)
            ->assertJsonPath('data.preferences.dispersals', true);

        $this->assertNull($service->create($admin, [
            'type' => UserNotification::TYPE_BENEFICIARY_ADDED,
            'title' => 'Suppressed',
            'message' => 'Should not write.',
        ]));

        // A category left on still writes.
        $this->assertNotNull($service->create($admin, [
            'type' => UserNotification::TYPE_ANIMAL_DISPERSED,
            'title' => 'Still delivered',
            'message' => 'This category is enabled.',
        ]));

        $this->actingAs($admin)
            ->getJson('/api/v1/notifications/preferences')
            ->assertOk()
            ->assertJsonPath('data.preferences.beneficiaries', false);
    }

    public function test_completed_field_visits_notify_supervisors_but_not_the_author(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $colleague = User::factory()->create(['role' => 'technician']);
        $admin = $this->admin();
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();

        $this->actingAs($technician)
            ->postJson('/api/v1/field-visits', [
                'beneficiary_id' => $beneficiary->id,
                'visited_on' => now()->toDateString(),
                'purpose' => 'routine-monitoring',
                'has_photo' => true,
                'notes' => 'Routine check completed.',
            ])->assertCreated();

        $this->assertDatabaseHas('user_notifications', [
            'user_id' => $admin->id,
            'type' => UserNotification::TYPE_FIELD_VISIT_COMPLETED,
            'beneficiary_id' => $beneficiary->id,
        ]);

        // The household's assigned technician is the author, so no self-alert;
        // an unrelated technician has no reason to receive this trip.
        foreach ([$technician, $colleague] as $notRecipient) {
            $this->assertDatabaseMissing('user_notifications', [
                'user_id' => $notRecipient->id,
                'type' => UserNotification::TYPE_FIELD_VISIT_COMPLETED,
            ]);
        }
    }
}
