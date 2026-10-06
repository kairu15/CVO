<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Admin User Management (item: editable user management).
 *
 * The screen is `/dashboard/admin/users`; these tests cover the API behind it:
 * creating staff accounts, editing them, deactivating (soft delete) and
 * reactivating, plus the admin-only enforcement that has to hold when someone
 * calls the endpoints directly rather than clicking a hidden button.
 */
class AdminUserManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_admins_can_manage_accounts(): void
    {
        $target = User::factory()->create(['role' => 'farmer']);

        foreach (['doctor', 'technician', 'farmer'] as $role) {
            $user = User::factory()->create(['role' => $role]);

            $this->actingAs($user)
                ->postJson('/api/v1/admin/users', [
                    'name' => 'New Staff',
                    'email' => 'new.staff@example.com',
                    'role' => 'technician',
                    'password' => 'Str0ng!Pass',
                    'password_confirmation' => 'Str0ng!Pass',
                ])
                ->assertForbidden();

            $this->actingAs($user)
                ->patchJson("/api/v1/admin/users/{$target->id}", [
                    'name' => 'Renamed',
                    'email' => $target->email,
                ])
                ->assertForbidden();

            $this->actingAs($user)
                ->deleteJson("/api/v1/admin/users/{$target->id}")
                ->assertForbidden();

            $this->actingAs($user)
                ->postJson("/api/v1/admin/users/{$target->id}/reactivate")
                ->assertForbidden();
        }

        // Nothing was touched by the rejected calls.
        $this->assertDatabaseHas('users', [
            'id' => $target->id,
            'name' => $target->name,
            'deleted_at' => null,
        ]);
    }

    public function test_admin_can_create_a_staff_account(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $response = $this->actingAs($admin)->postJson('/api/v1/admin/users', [
            'name' => 'Doc Reyes',
            'email' => 'Doc.Reyes@Example.com',
            'role' => 'doctor',
            'password' => 'Str0ng!Pass',
            'password_confirmation' => 'Str0ng!Pass',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.role', 'doctor')
            ->assertJsonPath('data.status', 'active')
            // Email is normalised, so the account signs in with one spelling.
            ->assertJsonPath('data.email', 'doc.reyes@example.com');

        $created = User::query()->where('email', 'doc.reyes@example.com')->firstOrFail();

        $this->assertNotSame('Str0ng!Pass', $created->password);
        $this->assertTrue(Hash::check('Str0ng!Pass', $created->password));

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $admin->id,
            'action' => 'user_created',
            'target_id' => $created->id,
        ]);
    }

    public function test_a_created_staff_account_can_sign_in(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)->postJson('/api/v1/admin/users', [
            'name' => 'Tech Santos',
            'email' => 'tech.santos@example.com',
            'role' => 'technician',
            'password' => 'Str0ng!Pass',
            'password_confirmation' => 'Str0ng!Pass',
        ])->assertCreated();

        $this->postJson('/api/v1/login', [
            'identifier' => 'tech.santos@example.com',
            'password' => 'Str0ng!Pass',
        ])->assertOk()->assertJsonPath('data.role', 'technician');
    }

    public function test_creating_a_farmer_account_is_rejected(): void
    {
        // Farmer accounts come from public self-registration, which also
        // creates the beneficiary record. Manufacturing one here would leave
        // an account with no dispersal attached.
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)->postJson('/api/v1/admin/users', [
            'name' => 'Nena Farmer',
            'email' => 'nena@example.com',
            'role' => 'farmer',
            'password' => 'Str0ng!Pass',
            'password_confirmation' => 'Str0ng!Pass',
        ])->assertUnprocessable()->assertJsonValidationErrors(['role']);

        $this->assertDatabaseMissing('users', ['email' => 'nena@example.com']);
    }

    public function test_store_validates_email_taken_and_password_strength(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        User::factory()->create(['email' => 'taken@example.com']);

        $this->actingAs($admin)->postJson('/api/v1/admin/users', [
            'name' => 'Copy Cat',
            'email' => 'taken@example.com',
            'role' => 'technician',
            'password' => 'Str0ng!Pass',
            'password_confirmation' => 'Str0ng!Pass',
        ])->assertUnprocessable()->assertJsonValidationErrors(['email']);

        $this->actingAs($admin)->postJson('/api/v1/admin/users', [
            'name' => 'Weak Pass',
            'email' => 'weak@example.com',
            'role' => 'technician',
            'password' => 'password',
            'password_confirmation' => 'password',
        ])->assertUnprocessable()->assertJsonValidationErrors(['password']);
    }

    public function test_admin_can_edit_an_accounts_name_and_email(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $target = User::factory()->create(['role' => 'technician']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$target->id}", [
                'name' => 'Jun Santos',
                'email' => 'jun.santos@example.com',
            ])
            ->assertOk()
            ->assertJsonPath('data.name', 'Jun Santos')
            ->assertJsonPath('data.email', 'jun.santos@example.com');

        $this->assertDatabaseHas('users', [
            'id' => $target->id,
            'name' => 'Jun Santos',
            'email' => 'jun.santos@example.com',
        ]);
    }

    public function test_editing_an_account_can_change_its_role(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $target = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$target->id}", [
                'name' => $target->name,
                'email' => $target->email,
                'role' => 'technician',
            ])
            ->assertOk()
            ->assertJsonPath('data.role', 'technician');

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $admin->id,
            'action' => 'role_changed',
            'target_id' => $target->id,
        ]);
    }

    public function test_admin_cannot_change_their_own_role_through_the_edit_endpoint(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$admin->id}", [
                'name' => $admin->name,
                'email' => $admin->email,
                'role' => 'farmer',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['role']);

        // Editing your own name/email is fine; only the role is refused.
        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$admin->id}", [
                'name' => 'CVO Chief',
                'email' => $admin->email,
            ])
            ->assertOk()
            ->assertJsonPath('data.name', 'CVO Chief');

        $this->assertDatabaseHas('users', ['id' => $admin->id, 'role' => 'admin']);
    }

    public function test_update_validates_email_uniqueness_against_other_accounts(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $other = User::factory()->create(['email' => 'other@example.com']);
        $target = User::factory()->create(['role' => 'technician']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$target->id}", [
                'name' => $target->name,
                'email' => 'other@example.com',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);

        $this->assertDatabaseHas('users', ['id' => $other->id, 'email' => 'other@example.com']);
    }

    public function test_admin_can_deactivate_an_account(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $target = User::factory()->create(['role' => 'technician']);

        $target->createToken('field-phone');
        DB::table('sessions')->insert([
            'id' => 'session-'.$target->id,
            'user_id' => $target->id,
            'payload' => 'x',
            'last_activity' => now()->getTimestamp(),
        ]);

        $this->actingAs($admin)
            ->deleteJson("/api/v1/admin/users/{$target->id}")
            ->assertOk()
            ->assertJsonPath('data.status', 'deactivated');

        $this->assertSoftDeleted('users', ['id' => $target->id]);

        // Deactivation is immediate: no token and no session survives it.
        $this->assertDatabaseCount('personal_access_tokens', 0);
        $this->assertDatabaseCount('sessions', 0);

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $admin->id,
            'action' => 'user_deactivated',
            'target_id' => $target->id,
        ]);
    }

    public function test_a_deactivated_account_cannot_sign_in(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $target = User::factory()->create([
            'role' => 'technician',
            'email' => 'gone@example.com',
        ]);

        $this->actingAs($admin)->deleteJson("/api/v1/admin/users/{$target->id}")->assertOk();

        $this->postJson('/api/v1/login', [
            'identifier' => 'gone@example.com',
            'password' => 'password',
        ])->assertUnprocessable()->assertJsonValidationErrors(['identifier']);
    }

    public function test_admin_cannot_deactivate_their_own_account(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->deleteJson("/api/v1/admin/users/{$admin->id}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['user']);

        $this->assertDatabaseHas('users', ['id' => $admin->id, 'deleted_at' => null]);
    }

    public function test_a_deactivated_account_can_still_be_edited(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $target = User::factory()->create([
            'role' => 'technician',
            'email' => 'gone@example.com',
        ]);

        $this->actingAs($admin)->deleteJson("/api/v1/admin/users/{$target->id}")->assertOk();

        // The account is coming back but their address changed while they
        // were away — the edit reaches the soft-deleted row instead of 404ing.
        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$target->id}", [
                'name' => $target->name,
                'email' => 'new.address@example.com',
            ])
            ->assertOk()
            ->assertJsonPath('data.email', 'new.address@example.com')
            ->assertJsonPath('data.status', 'deactivated');

        $this->assertDatabaseHas('users', [
            'id' => $target->id,
            'email' => 'new.address@example.com',
        ]);

        // The edit did not bring the account back.
        $this->assertSoftDeleted('users', ['id' => $target->id]);
    }

    public function test_admin_can_reactivate_a_deactivated_account(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $target = User::factory()->create([
            'role' => 'technician',
            'email' => 'back@example.com',
        ]);

        $this->actingAs($admin)->deleteJson("/api/v1/admin/users/{$target->id}")->assertOk();

        $this->actingAs($admin)
            ->postJson("/api/v1/admin/users/{$target->id}/reactivate")
            ->assertOk()
            ->assertJsonPath('data.status', 'active');

        $this->assertDatabaseHas('users', ['id' => $target->id, 'deleted_at' => null]);

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $admin->id,
            'action' => 'user_reactivated',
            'target_id' => $target->id,
        ]);

        $this->postJson('/api/v1/login', [
            'identifier' => 'back@example.com',
            'password' => 'password',
        ])->assertOk()->assertJsonPath('data.role', 'technician');
    }

    public function test_the_list_defaults_to_active_accounts_and_can_include_deactivated_ones(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $active = User::factory()->create(['role' => 'technician']);
        $gone = User::factory()->create(['role' => 'technician']);
        $gone->delete();

        // Default: the technician pickers that share this endpoint must never
        // be offered a deactivated technician.
        $this->actingAs($admin)
            ->getJson('/api/v1/admin/users?role=technician')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $active->id);

        // User Management asks for everything, with the status on each row.
        $all = $this->actingAs($admin)
            ->getJson('/api/v1/admin/users?role=technician&status=all')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $statuses = collect($all->json('data'))->pluck('status', 'id');
        $this->assertSame('active', $statuses[$active->id]);
        $this->assertSame('deactivated', $statuses[$gone->id]);

        $onlyGone = $this->actingAs($admin)
            ->getJson('/api/v1/admin/users?status=deactivated')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->assertSame($gone->id, $onlyGone->json('data.0.id'));
    }

    public function test_status_filter_rejects_unknown_values(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/users?status=deleted')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);
    }
}
