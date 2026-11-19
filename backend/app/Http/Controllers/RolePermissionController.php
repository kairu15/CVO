<?php

namespace App\Http\Controllers;

use App\Http\Requests\AdminRolePermissionRequest;
use App\Http\Requests\AdminRolePermissionsBulkRequest;
use App\Http\Requests\AdminRolePermissionsIndexRequest;
use App\Models\ActivityLog;
use App\Models\Permission;
use App\Models\RolePermission;
use App\Models\User;
use App\Services\AuditLogger;
use App\Support\RoleCatalog;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * The Roles & Permissions matrix — the runtime half of the authorization
 * system.
 *
 * GET    /api/v1/admin/roles/permissions          the matrix + role summaries
 * PATCH  /api/v1/admin/roles/{role}/permissions  flip one cell
 * PATCH  /api/v1/admin/roles/{role}/permissions/bulk  flip a group in one transaction
 *
 * The seed is the de facto permission set, so nothing changed on day one; from
 * then on a grant change takes effect on the NEXT request — the role → keys
 * cache is dropped on every write, so a worker can never keep enforcing a
 * revoked grant.
 *
 * LOCKOUT PROTECTION: `manage_roles` must always be held by at least one
 * active account. Removing a grant is refused with 422 when — after the
 * removal — no role that still holds `manage_roles` has any active member.
 *
 * DEPENDENCIES: write capabilities declare the read capability they need. The
 * endpoint refuses to grant a write without its dependency (the SPA may ask
 * for `with_dependencies` to include them), and refuses to revoke a
 * capability still required by another granted one. This keeps the matrix
 * internally coherent instead of relying on the UI to avoid nonsense.
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

        DB::transaction(function () use ($request, $role, $permission, $granted, $validated): void {
            $this->applyChange(
                $role,
                new Collection([$permission]),
                $granted,
                (bool) ($validated['with_dependencies'] ?? false),
                $request->user(),
            );

            Permission::flushRoleCache();
        });

        return response()->json(['data' => $this->matrix()]);
    }

    public function updateBulk(AdminRolePermissionsBulkRequest $request, string $role): JsonResponse
    {
        $validated = $request->validated();
        $granted = (bool) $validated['granted'];
        $permissions = Permission::query()
            ->whereIn('key', $validated['permission_keys'])
            ->get();

        if ($permissions->isEmpty()) {
            abort(422, 'No known permissions were selected.');
        }

        if (! $granted) {
            if ($permissions->contains('key', self::MANAGE_ROLES)) {
                $this->refuseIfLastManager($role);
            }
        }

        DB::transaction(function () use ($request, $role, $permissions, $granted): void {
            $this->applyChange(
                $role,
                $permissions,
                $granted,
                true,
                $request->user(),
            );

            Permission::flushRoleCache();
        });

        return response()->json(['data' => $this->matrix()]);
    }

    /**
     * Apply a grant/revoke decision to one or more capabilities, enforcing
     * dependencies and auditing every row that actually changes.
     *
     * @param  Collection<int, Permission>  $targets
     */
    private function applyChange(
        string $role,
        Collection $targets,
        bool $granted,
        bool $withDependencies,
        ?User $actor,
    ): void {
        $grantedKeys = $this->grantedKeys($role);

        if ($granted) {
            if ($withDependencies) {
                $targets = $this->withDependencies($targets);
            } else {
                $missing = $targets
                    ->flatMap(fn (Permission $permission): array => $permission->requires ?? [])
                    ->unique()
                    ->reject(fn (string $key): bool => in_array($key, $grantedKeys, true))
                    ->values();

                if ($missing->isNotEmpty()) {
                    abort(422, sprintf(
                        'Grant %s first: %s.',
                        $missing->implode(', '),
                        'this capability depends on it',
                    ));
                }
            }

            foreach ($targets as $permission) {
                if (in_array($permission->key, $grantedKeys, true)) {
                    continue;
                }

                RolePermission::create([
                    'role' => $role,
                    'permission_id' => $permission->id,
                ]);

                $this->audit->log($actor, 'permissions_updated', $permission, [
                    'role' => $role,
                    'granted' => true,
                ], ['role' => $role, 'granted' => false], ['role' => $role, 'granted' => true]);

                $grantedKeys[] = $permission->key;
            }

            return;
        }

        $revoking = $targets->pluck('key')->all();
        $dependents = $this->dependentsStillGranted($revoking, $grantedKeys);

        if ($dependents->isNotEmpty()) {
            abort(422, sprintf(
                'Revoke %s first: %s still require%s the selected capability.',
                $dependents->pluck('key')->implode(', '),
                $dependents->pluck('key')->implode(', '),
                $dependents->count() === 1 ? 's' : '',
            ));
        }

        $rows = RolePermission::query()
            ->where('role', $role)
            ->whereIn('permission_id', $targets->pluck('id'))
            ->get();

        foreach ($rows as $row) {
            $permission = $targets->firstWhere('id', $row->permission_id);

            if ($permission === null) {
                continue;
            }

            $row->delete();

            $this->audit->log($actor, 'permissions_updated', $permission, [
                'role' => $role,
                'granted' => false,
            ], ['role' => $role, 'granted' => true], ['role' => $role, 'granted' => false]);
        }
    }

    /**
     * A target plus every capability it transitively requires. Used by group
     * grants so a bulk action cannot create an unusable permission set.
     *
     * @param  Collection<int, Permission>  $targets
     * @return Collection<int, Permission>
     */
    private function withDependencies(Collection $targets): Collection
    {
        $all = $targets->keyBy('key');
        $queue = $targets
            ->flatMap(fn (Permission $permission): array => $permission->requires ?? [])
            ->unique()
            ->values()
            ->all();

        while ($queue !== []) {
            $key = array_shift($queue);

            if ($all->has($key)) {
                continue;
            }

            $permission = Permission::query()->where('key', $key)->first();

            if ($permission === null) {
                continue;
            }

            $all->put($key, $permission);

            foreach ($permission->requires ?? [] as $required) {
                $queue[] = $required;
            }
        }

        return $all->values();
    }

    /**
     * Granted capabilities that require one of the keys being revoked and are
     * not themselves part of the same operation.
     *
     * @param  list<string>  $revoking
     * @param  list<string>  $grantedKeys
     * @return Collection<int, Permission>
     */
    private function dependentsStillGranted(array $revoking, array $grantedKeys): Collection
    {
        return Permission::query()
            ->whereIn('key', $grantedKeys)
            ->whereNotIn('key', $revoking)
            ->get()
            ->filter(fn (Permission $permission): bool => count(array_intersect(
                $permission->requires ?? [],
                $revoking,
            )) > 0)
            ->values();
    }

    /**
     * @return list<string>
     */
    private function grantedKeys(string $role): array
    {
        return Permission::query()
            ->join('role_permissions', 'role_permissions.permission_id', '=', 'permissions.id')
            ->where('role_permissions.role', $role)
            ->pluck('permissions.key')
            ->all();
    }

    /**
     * The whole matrix: role summaries, permissions grouped in render order,
     * lockout inputs and the last matrix change.
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
                    'description' => $permission->description,
                    'risk' => $permission->risk,
                    'requires' => $permission->requires ?? [],
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

        $userCounts = User::query()
            ->withTrashed()
            ->selectRaw(
                'role, COUNT(*) as total, '
                .'SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as active_users, '
                .'SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) as deactivated_users',
            )
            ->groupBy('role')
            ->get()
            ->keyBy('role');

        $grantedCounts = RolePermission::query()
            ->selectRaw('role, COUNT(*) as total')
            ->groupBy('role')
            ->pluck('total', 'role');

        $managers = $this->manageRolesHolders();
        $totalPermissions = $permissions->count();

        return [
            'roles' => $roles
                ->map(function (string $role) use ($userCounts, $grantedCounts, $managers, $totalPermissions): array {
                    $meta = RoleCatalog::for($role);
                    $counts = $userCounts->get($role);

                    return [
                        'key' => $role,
                        'label' => $meta['label'],
                        'short_label' => $meta['short_label'],
                        'dashboard' => $meta['dashboard'],
                        'description' => $meta['description'],
                        'active_users' => (int) ($counts->active_users ?? 0),
                        'deactivated_users' => (int) ($counts->deactivated_users ?? 0),
                        'granted_count' => (int) ($grantedCounts[$role] ?? 0),
                        'total_permissions' => $totalPermissions,
                        'manages_roles' => isset($managers[$role]),
                    ];
                })
                ->all(),
            'total_permissions' => $totalPermissions,
            'groups' => $groups,
            'manage_roles_holders' => $managers,
            'last_change' => $this->lastChange(),
        ];
    }

    /**
     * @return array{at: string, actor_name: string|null, role: string|null}|null
     */
    private function lastChange(): ?array
    {
        $row = ActivityLog::query()
            ->where('action', 'permissions_updated')
            ->latest('id')
            ->first();

        if ($row === null) {
            return null;
        }

        return [
            'at' => $row->created_at?->toIso8601String(),
            'actor_name' => $row->actor_name ?? $row->actor?->name,
            'role' => $row->context['role'] ?? null,
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
