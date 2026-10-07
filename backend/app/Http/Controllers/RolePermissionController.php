<?php

namespace App\Http\Controllers;

use App\Http\Requests\AdminRolePermissionRequest;
use App\Http\Requests\AdminRolePermissionsIndexRequest;
use App\Models\Permission;
use App\Models\RolePermission;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * The Roles & Permissions matrix — the runtime half of the authorization
 * system.
 *
 * GET    /api/v1/admin/roles/permissions   the whole matrix (roles × grants)
 * PATCH  /api/v1/admin/roles/{role}/permissions   flip one cell
 *
 * The seed is the de facto permission set (see the creating migration), so
 * nothing changes on day one; from then on a grant change takes effect on
 * the NEXT request — the role → keys cache is dropped on every write, so a
 * worker can never keep enforcing a revoked grant.
 *
 * LOCKOUT PROTECTION: `manage_roles` must always be held by at least one
 * active account. Removing a grant is refused with 422 when — after the
 * removal — no role that still holds `manage_roles` has any active member.
 * With the shipped seed that means exactly: the last thing that can edit
 * this matrix cannot edit itself away.
 */
class RolePermissionController extends Controller
{
    /** The one capability that must never be lost entirely. */
    private const MANAGE_ROLES = 'manage_roles';

    public function __construct(private readonly AuditLogger $audit) {}

    public function index(AdminRolePermissionsIndexRequest $request): JsonResponse
    {
        return response()->json(['data' => $this->matrix()]);
    }

    public function update(AdminRolePermissionRequest $request, string $role): JsonResponse
    {
        $validated = $request->validated();

        $permission = Permission::query()->where('key', $validated['permission'])->firstOrFail();
        $granted = (bool) $validated['granted'];

        if (! $granted && $permission->key === self::MANAGE_ROLES) {
            $this->refuseIfLastManager($role);
        }

        if ($granted) {
            RolePermission::firstOrCreate([
                'role' => $role,
                'permission_id' => $permission->id,
            ]);
        } else {
            RolePermission::query()
                ->where('role', $role)
                ->where('permission_id', $permission->id)
                ->delete();
        }

        // Grants must reach every consumer immediately — the next request
        // after a revoke is evaluated against the new matrix.
        Permission::flushRoleCache();

        $this->audit->log($request->user(), 'permissions_updated', $permission, [
            'role' => $role,
            'granted' => $granted,
        ]);

        return response()->json(['data' => $this->matrix()]);
    }

    /**
     * The whole matrix: roles in column order, permissions grouped in the
     * order the SPA renders them.
     *
     * @return array<string, mixed>
     */
    private function matrix(): array
    {
        $roles = collect(User::ROLES)->values();

        $permissions = Permission::query()
            ->with('rolePermissions')
            ->orderBy('group')
            ->orderBy('sort_order')
            ->get();

        $groups = $permissions
            ->groupBy('group')
            ->map(fn ($rows, string $group): array => [
                'group' => $group,
                'permissions' => $rows->map(fn (Permission $permission): array => [
                    'key' => $permission->key,
                    'label' => $permission->label,
                    'granted' => $roles->mapWithKeys(
                        fn (string $role): array => [
                            $role => $permission->rolePermissions
                                ->contains(fn (RolePermission $grant) => $grant->role === $role),
                        ],
                    )->all(),
                ])->all(),
            ])
            ->values()
            ->all();

        return [
            'roles' => $roles
                ->map(fn (string $role): array => ['key' => $role, 'label' => ucfirst($role)])
                ->all(),
            'groups' => $groups,
            // Which roles currently hold manage_roles, each with the number
            // of ACTIVE accounts holding it — the lockout guard's inputs,
            // so the SPA can warn before the server has to refuse.
            'manage_roles_holders' => $this->manageRolesHolders(),
        ];
    }

    /**
     * Roles holding `manage_roles` and their active-account counts.
     *
     * @return array<string, int>
     */
    private function manageRolesHolders(): array
    {
        $permissionId = Permission::query()->where('key', self::MANAGE_ROLES)->value('id');

        if ($permissionId === null) {
            return [];
        }

        return DB::table('role_permissions')
            ->join('users', 'users.role', '=', 'role_permissions.role')
            ->where('role_permissions.permission_id', $permissionId)
            ->whereNull('users.deleted_at')
            ->groupBy('role_permissions.role')
            ->selectRaw('role_permissions.role as role, count(*) as holders')
            ->pluck('holders', 'role')
            ->all();
    }

    /**
     * Refuse removing `manage_roles` from a role when no ACTIVE account would
     * hold it afterwards — the matrix must never be uneditable.
     */
    private function refuseIfLastManager(string $role): void
    {
        $holders = $this->manageRolesHolders();
        $remaining = $holders;
        unset($remaining[$role]);

        if (array_sum($remaining) > 0) {
            return;
        }

        abort(422, sprintf(
            'This would leave the system with no one able to manage roles and permissions. '
            .'Grant %s to another role (or another active account) first.',
            self::MANAGE_ROLES,
        ));
    }
}
