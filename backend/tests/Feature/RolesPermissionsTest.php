<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The capability matrix end to end.
 *
 * The seed is the de facto permission set, so every assertion about day-one
 * behaviour doubles as a regression guard on the pre-matrix authorization:
 * if a grant drifts from what the Policies used to hardcode, one of these
 * fails.
 */
class RolesPermissionsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $technician;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
        $this->technician = User::factory()->create(['role' => 'technician']);
    }

    // ── Reading the matrix ──────────────────────────────────────────────────

    public function test_a_guest_cannot_read_the_matrix(): void
    {
        $this->getJson('/api/v1/admin/roles/permissions')->assertUnauthorized();
    }

    public function test_only_manage_roles_holders_can_read_the_matrix(): void
    {
        $this->actingAs($this->technician)
            ->getJson('/api/v1/admin/roles/permissions')
            ->assertForbidden();
    }

    public function test_the_matrix_reflects_the_de_facto_seed(): void
    {
        $data = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/roles/permissions')
            ->assertOk()
            ->json('data');

        // Two roles only: the doctor role was retired into the technician.
        $roles = collect($data['roles'])->pluck('key')->all();
        $this->assertSame(['admin', 'technician'], $roles);

        $grants = collect($data['groups'])
            ->flatMap(fn (array $group) => $group['permissions'])
            ->mapWithKeys(fn (array $permission) => [$permission['key'] => $permission['granted']]);

        // Spot-check the seed against the Policies' hardcoded checks.
        $this->assertTrue($grants['manage_roles']['admin']);
        $this->assertTrue($grants['view_reports']['admin']);
        $this->assertFalse($grants['view_reports']['technician']);
        // The clinical authoring grants moved onto the technician with the
        // retired doctor role; the administrator still cannot author.
        $this->assertTrue($grants['health_records.create']['technician']);
        $this->assertTrue($grants['case_notes.create']['technician']);
        $this->assertTrue($grants['health_records.update']['technician']);
        $this->assertFalse($grants['health_records.create']['admin']);
        $this->assertTrue($grants['monitoring.create']['technician']);
        $this->assertTrue($grants['beneficiaries.view']['technician']);
        $this->assertFalse($grants['beneficiaries.delete']['technician']);
        $this->assertTrue($grants['dispersals.create']['technician']);

        // Lockout inputs ride along for the SPA's warning.
        $this->assertSame(1, $data['manage_roles_holders']['admin']);
    }

    // ── Flipping a cell ─────────────────────────────────────────────────────

    public function test_a_guest_and_non_holder_cannot_flip_a_cell(): void
    {
        $this->patchJson('/api/v1/admin/roles/technician/permissions', [
            'permission' => 'view_reports',
            'granted' => true,
        ])->assertUnauthorized();

        $this->actingAs($this->technician)
            ->patchJson('/api/v1/admin/roles/technician/permissions', [
                'permission' => 'view_reports',
                'granted' => true,
            ])
            ->assertForbidden();
    }

    public function test_revoking_a_capability_takes_effect_on_the_next_request(): void
    {
        $beneficiary = Beneficiary::factory()->create();

        // The technician can author today (seeded grant)...
        $this->actingAs($this->technician)->postJson('/api/v1/health-records', [
            'beneficiary_id' => $beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Healthy',
        ])->assertCreated();

        // ...revoke through the matrix...
        $this->actingAs($this->admin)
            ->patchJson("/api/v1/admin/roles/technician/permissions", [
                'permission' => 'health_records.create',
                'granted' => false,
            ])
            ->assertOk();

        // ...and the SAME session is refused on the very next request — no
        // re-login, no cache staleness.
        $this->actingAs($this->technician)->postJson('/api/v1/health-records', [
            'beneficiary_id' => $beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Also healthy',
        ])->assertForbidden();

        $this->assertDatabaseCount('health_records', 1);
    }

    public function test_granting_a_capability_opens_the_module_for_that_role(): void
    {
        // Reports are admin-only in the seed.
        $this->actingAs($this->technician)
            ->getJson('/api/v1/admin/report')
            ->assertForbidden();

        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/technician/permissions', [
                'permission' => 'view_reports',
                'granted' => true,
            ])
            ->assertOk();

        // The technician's reads are city-wide (it absorbed the old doctor
        // role's oversight) — and the module now opens for it too.
        $this->actingAs($this->technician)
            ->getJson('/api/v1/admin/report')
            ->assertOk();
    }

    public function test_an_unknown_permission_or_role_is_rejected(): void
    {
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/technician/permissions', [
                'permission' => 'not_a_permission',
                'granted' => true,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['permission']);

        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/superadmin/permissions', [
                'permission' => 'view_reports',
                'granted' => true,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['role']);

        // The doctor role was retired into technician — there is no matrix
        // column left to flip for it.
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/doctor/permissions', [
                'permission' => 'view_reports',
                'granted' => true,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['role']);
    }

    public function test_flipping_a_cell_is_audited(): void
    {
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/technician/permissions', [
                'permission' => 'beneficiaries.delete',
                'granted' => true,
            ])
            ->assertOk();

        $this->assertDatabaseHas('role_permissions', [
            'role' => 'technician',
            'permission_id' => Permission::where('key', 'beneficiaries.delete')->value('id'),
        ]);
        $this->assertDatabaseHas('activity_logs', ['action' => 'permissions_updated']);
    }

    // ── Lockout protection ──────────────────────────────────────────────────

    public function test_the_last_manage_roles_holder_cannot_have_it_revoked(): void
    {
        // admin is the only role holding manage_roles with active members.
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/admin/permissions', [
                'permission' => 'manage_roles',
                'granted' => false,
            ])
            ->assertStatus(422)
            ->assertJsonPath('message', fn (string $message) => str_contains($message, 'no one able to manage roles'));

        // The grant survived — the matrix stays editable.
        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/roles/permissions')
            ->assertOk();
    }

    public function test_manage_roles_can_move_off_admin_once_another_role_holds_it(): void
    {
        // Grant manage_roles to technician (an active technician account exists)...
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/technician/permissions', [
                'permission' => 'manage_roles',
                'granted' => true,
            ])
            ->assertOk();

        // ...now admin can let it go: technician can hold the pen.
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/admin/permissions', [
                'permission' => 'manage_roles',
                'granted' => false,
            ])
            ->assertOk();

        $this->actingAs($this->technician)
            ->getJson('/api/v1/admin/roles/permissions')
            ->assertOk();
    }

    public function test_a_deactivated_holder_does_not_count_toward_lockout_safety(): void
    {
        // A second admin exists but is DEACTIVATED (soft-deleted) — it must
        // not keep the last active manager from being locked out, and must
        // not make the guard pass when only it would hold the pen.
        $inactive = User::factory()->create(['role' => 'admin']);
        $inactive->delete();

        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/admin/permissions', [
                'permission' => 'manage_roles',
                'granted' => false,
            ])
            ->assertStatus(422);
    }

    // ── Metadata, dependencies and bulk groups ─────────────────────────────

    public function test_the_matrix_describes_roles_permissions_and_their_dependencies(): void
    {
        $data = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/roles/permissions')
            ->assertOk()
            ->json('data');

        $admin = collect($data['roles'])->firstWhere('key', 'admin');
        $allPermissions = collect($data['groups'])
            ->flatMap(fn (array $group): array => $group['permissions']);

        $this->assertSame('Administrator', $admin['label']);
        $this->assertSame(1, $admin['active_users']);
        $this->assertSame(0, $admin['deactivated_users']);
        $this->assertTrue($admin['manages_roles']);
        $this->assertSame($allPermissions->count(), $admin['total_permissions']);

        $permission = $allPermissions->firstWhere('key', 'health_records.create');

        $this->assertNotNull($permission['description']);
        $this->assertSame('standard', $permission['risk']);
        $this->assertSame(['health_records.view'], $permission['requires']);
        $this->assertArrayHasKey('last_change', $data);
    }

    public function test_a_write_grant_requires_its_read_dependency_unless_asked_for_together(): void
    {
        $view = Permission::create([
            'key' => 'test_records.view',
            'label' => 'View test records',
            'group' => 'Test records',
            'sort_order' => 1,
            'risk' => 'standard',
        ]);
        $write = Permission::create([
            'key' => 'test_records.create',
            'label' => 'Create test records',
            'group' => 'Test records',
            'sort_order' => 2,
            'risk' => 'standard',
            'requires' => ['test_records.view'],
        ]);

        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/technician/permissions', [
                'permission' => $write->key,
                'granted' => true,
            ])
            ->assertStatus(422)
            ->assertJsonPath('message', fn (string $message) => str_contains($message, 'test_records.view'));

        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/technician/permissions', [
                'permission' => $write->key,
                'granted' => true,
                'with_dependencies' => true,
            ])
            ->assertOk();

        $this->assertDatabaseHas('role_permissions', [
            'role' => 'technician',
            'permission_id' => $view->id,
        ]);
        $this->assertDatabaseHas('role_permissions', [
            'role' => 'technician',
            'permission_id' => $write->id,
        ]);
        $this->assertSame(2, $this->permissionAuditCount());
    }

    public function test_a_dependency_cannot_be_revoked_while_a_granted_permission_needs_it(): void
    {
        $view = Permission::create([
            'key' => 'test_records.view',
            'label' => 'View test records',
            'group' => 'Test records',
            'sort_order' => 1,
            'risk' => 'standard',
        ]);
        $write = Permission::create([
            'key' => 'test_records.create',
            'label' => 'Create test records',
            'group' => 'Test records',
            'sort_order' => 2,
            'risk' => 'standard',
            'requires' => ['test_records.view'],
        ]);

        $this->grant($view->key);
        $this->grant($write->key);

        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/technician/permissions', [
                'permission' => $view->key,
                'granted' => false,
            ])
            ->assertStatus(422)
            ->assertJsonPath('message', fn (string $message) => str_contains($message, 'test_records.create'));

        // Revoking both together is allowed; the dependency is satisfied by
        // removing the dependent grant at the same time.
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/technician/permissions/bulk', [
                'permission_keys' => [$view->key, $write->key],
                'granted' => false,
            ])
            ->assertOk();

        $this->assertDatabaseMissing('role_permissions', [
            'role' => 'technician',
            'permission_id' => $view->id,
        ]);
        $this->assertDatabaseMissing('role_permissions', [
            'role' => 'technician',
            'permission_id' => $write->id,
        ]);
    }

    public function test_bulk_granting_a_group_adds_dependencies_and_writes_one_audit_row_per_change(): void
    {
        $view = Permission::create([
            'key' => 'test_records.view',
            'label' => 'View test records',
            'group' => 'Test records',
            'sort_order' => 1,
            'risk' => 'standard',
        ]);
        $write = Permission::create([
            'key' => 'test_records.create',
            'label' => 'Create test records',
            'group' => 'Test records',
            'sort_order' => 2,
            'risk' => 'standard',
            'requires' => ['test_records.view'],
        ]);

        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/technician/permissions/bulk', [
                'permission_keys' => [$write->key],
                'granted' => true,
            ])
            ->assertOk();

        $this->assertDatabaseHas('role_permissions', [
            'role' => 'technician',
            'permission_id' => $view->id,
        ]);
        $this->assertSame(2, $this->permissionAuditCount());
    }

    private function grant(string $permission): void
    {
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/technician/permissions', [
                'permission' => $permission,
                'granted' => true,
                'with_dependencies' => true,
            ])
            ->assertOk();
    }

    public function test_every_permission_used_by_the_backend_exists_in_the_catalog(): void
    {
        $catalog = Permission::query()->pluck('key')->all();
        $used = [];

        foreach (\Illuminate\Support\Facades\Route::getRoutes() as $route) {
            foreach ($route->gatherMiddleware() as $middleware) {
                if (! is_string($middleware) || ! str_starts_with($middleware, 'permission:')) {
                    continue;
                }

                foreach (explode(',', substr($middleware, strlen('permission:'))) as $key) {
                    $used[] = trim($key);
                }
            }
        }

        foreach (\Illuminate\Support\Facades\File::allFiles(app_path()) as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }

            preg_match_all(
                "/hasPermission\\(\s*['\"]([^'\"]+)/",
                $file->getContents(),
                $matches,
            );

            $used = [...$used, ...$matches[1]];
        }

        $missing = array_values(array_diff(array_unique($used), $catalog));

        $this->assertSame([], $missing, 'Permission keys used by code but missing from the catalog.');
    }

    private function permissionAuditCount(): int
    {
        return \App\Models\ActivityLog::query()
            ->where('action', 'permissions_updated')
            ->count();
    }

    // ── The /user payload carries the caller's capabilities ─────────────────

    public function test_the_user_endpoint_includes_permission_keys(): void
    {
        $this->actingAs($this->admin)
            ->getJson('/api/v1/user')
            ->assertOk()
            ->assertJsonPath('data.role', 'admin');

        $permissions = $this->actingAs($this->admin)
            ->getJson('/api/v1/user')
            ->json('data.permissions');

        $this->assertContains('manage_users', $permissions);
        $this->assertNotContains('health_records.create', $permissions);
    }
}
