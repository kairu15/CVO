<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminRoleTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_admins_can_access_admin_routes(): void
    {
        foreach (['doctor', 'technician', 'farmer'] as $role) {
            $user = User::factory()->create(['role' => $role]);

            $this->actingAs($user)
                ->getJson('/api/v1/admin/users?role=technician')
                ->assertForbidden();
        }
    }

    public function test_admin_can_list_technicians(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        User::factory()->count(2)->create(['role' => 'technician']);
        User::factory()->create(['role' => 'farmer']);

        $response = $this->actingAs($admin)->getJson('/api/v1/admin/users?role=technician');

        $response->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_admin_can_change_a_users_role(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $user = User::factory()->create(['role' => 'farmer']);

        $response = $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$user->id}/role", ['role' => 'technician']);

        $response->assertOk()->assertJsonPath('data.role', 'technician');

        $this->assertDatabaseHas('users', ['id' => $user->id, 'role' => 'technician']);
    }

    public function test_non_admins_cannot_change_roles(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($technician)
            ->patchJson("/api/v1/admin/users/{$farmer->id}/role", ['role' => 'admin'])
            ->assertForbidden();
    }

    public function test_admin_cannot_change_their_own_role(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $response = $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$admin->id}/role", ['role' => 'farmer']);

        $response->assertUnprocessable()->assertJsonValidationErrors(['role']);

        // The account keeps admin access — the change was refused, not applied.
        $this->assertDatabaseHas('users', ['id' => $admin->id, 'role' => 'admin']);
    }

    public function test_admin_cannot_self_demote_even_when_other_admins_exist(): void
    {
        // The rule is absolute rather than a last-administrator check, so the
        // presence of a second admin makes no difference.
        $admin = User::factory()->create(['role' => 'admin']);
        User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$admin->id}/role", ['role' => 'doctor'])
            ->assertUnprocessable();

        $this->assertDatabaseHas('users', ['id' => $admin->id, 'role' => 'admin']);
    }

    public function test_at_least_one_admin_always_remains(): void
    {
        // The only way to strand the system would be demoting the last admin,
        // and only an admin can assign roles — so the actor would have to be
        // that same account, which self-change already refuses. An admin
        // demoting a *different* admin therefore always leaves themselves.
        $admin = User::factory()->create(['role' => 'admin']);
        $other = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$other->id}/role", ['role' => 'doctor'])
            ->assertOk();

        $this->assertDatabaseHas('users', ['id' => $admin->id, 'role' => 'admin']);
        $this->assertSame(1, User::query()->where('role', 'admin')->count());
    }

    public function test_role_change_validates_the_role_value(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $user = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/users/{$user->id}/role", ['role' => 'superuser'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['role']);
    }
}
