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

    private User $doctor;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
        $this->doctor = User::factory()->create(['role' => 'doctor']);
    }

    // ── Reading the matrix ──────────────────────────────────────────────────

    public function test_a_guest_cannot_read_the_matrix(): void
    {
        $this->getJson('/api/v1/admin/roles/permissions')->assertUnauthorized();
    }

    public function test_only_manage_roles_holders_can_read_the_matrix(): void
    {
        $this->actingAs($this->doctor)
            ->getJson('/api/v1/admin/roles/permissions')
            ->assertForbidden();
    }

    public function test_the_matrix_reflects_the_de_facto_seed(): void
    {
        $data = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/roles/permissions')
            ->assertOk()
            ->json('data');

        $roles = collect($data['roles'])->pluck('key')->all();
        $this->assertSame(['admin', 'doctor', 'technician', 'farmer'], $roles);

        $grants = collect($data['groups'])
            ->flatMap(fn (array $group) => $group['permissions'])
            ->mapWithKeys(fn (array $permission) => [$permission['key'] => $permission['granted']]);

        // Spot-check the seed against the old hardcoded checks.
        $this->assertTrue($grants['manage_roles']['admin']);
        $this->assertTrue($grants['view_reports']['admin']);
        $this->assertFalse($grants['view_reports']['doctor']);
        $this->assertTrue($grants['health_records.create']['doctor']);
        $this->assertFalse($grants['health_records.create']['admin']);
        $this->assertTrue($grants['monitoring.create']['technician']);
        $this->assertTrue($grants['beneficiaries.view']['farmer']);
        $this->assertFalse($grants['beneficiaries.delete']['doctor']);
        $this->assertTrue($grants['dispersals.create']['farmer']);

        // Lockout inputs ride along for the SPA's warning.
        $this->assertSame(1, $data['manage_roles_holders']['admin']);
    }

    // ── Flipping a cell ─────────────────────────────────────────────────────

    public function test_a_guest_and_non_holder_cannot_flip_a_cell(): void
    {
        $this->patchJson('/api/v1/admin/roles/doctor/permissions', [
            'permission' => 'view_reports',
            'granted' => true,
        ])->assertUnauthorized();

        $this->actingAs($this->doctor)
            ->patchJson('/api/v1/admin/roles/doctor/permissions', [
                'permission' => 'view_reports',
                'granted' => true,
            ])
            ->assertForbidden();
    }

    public function test_revoking_a_capability_takes_effect_on_the_next_request(): void
    {
        $beneficiary = Beneficiary::factory()->create();

        // Doctor can author today (seeded grant)...
        $this->actingAs($this->doctor)->postJson('/api/v1/health-records', [
            'beneficiary_id' => $beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Healthy',
        ])->assertCreated();

        // ...revoke through the matrix...
        $this->actingAs($this->admin)
            ->patchJson("/api/v1/admin/roles/doctor/permissions", [
                'permission' => 'health_records.create',
                'granted' => false,
            ])
            ->assertOk();

        // ...and the SAME session is refused on the very next request — no
        // re-login, no cache staleness.
        $this->actingAs($this->doctor)->postJson('/api/v1/health-records', [
            'beneficiary_id' => $beneficiary->id,
            'date_recorded' => now()->toDateString(),
            'diagnosis' => 'Also healthy',
        ])->assertForbidden();

        $this->assertDatabaseCount('health_records', 1);
    }

    public function test_granting_a_capability_opens_the_module_for_that_role(): void
    {
        // Reports are admin-only in the seed.
        $this->actingAs($this->doctor)
            ->getJson('/api/v1/admin/report')
            ->assertForbidden();

        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/doctor/permissions', [
                'permission' => 'view_reports',
                'granted' => true,
            ])
            ->assertOk();

        // The doctor's row-scope never changes — but the module now opens.
        $this->actingAs($this->doctor)
            ->getJson('/api/v1/admin/report')
            ->assertOk();
    }

    public function test_an_unknown_permission_or_role_is_rejected(): void
    {
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/doctor/permissions', [
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
        // Grant manage_roles to doctor (an active doctor account exists)...
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/doctor/permissions', [
                'permission' => 'manage_roles',
                'granted' => true,
            ])
            ->assertOk();

        // ...now admin can let it go: doctor can hold the pen.
        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/roles/admin/permissions', [
                'permission' => 'manage_roles',
                'granted' => false,
            ])
            ->assertOk();

        $this->actingAs($this->doctor)
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
