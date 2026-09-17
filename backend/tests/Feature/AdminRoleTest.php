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
