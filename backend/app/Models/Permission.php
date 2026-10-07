<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Cache;

/**
 * One capability in the Roles & Permissions matrix.
 *
 * The catalog lives in this table (seeded from the de facto set — see the
 * creating migration), not in config, because it is the thing an
 * administrator edits. `role_permissions` holds the grants; users hold a
 * role STRING, so `role_permissions.role` is that string, not an FK.
 */
class Permission extends Model
{
    /**
     * The pivot key used to cache the role → keys map. Cleared whenever the
     * matrix changes, so a long-running worker cannot keep enforcing a grant
     * that was just revoked.
     */
    public const CACHE_KEY = 'permissions.by_role';

    protected $fillable = ['key', 'label', 'group', 'sort_order'];

    public function rolePermissions(): HasMany
    {
        return $this->hasMany(RolePermission::class);
    }

    /**
     * The permission keys granted to a role, process-wide cached.
     *
     * @return list<string>
     */
    public static function keysForRole(string $role): array
    {
        $map = Cache::rememberForever(self::CACHE_KEY, fn () => self::roleMap());

        return $map[$role] ?? [];
    }

    /**
     * Drop the role → keys cache. Called by the matrix update endpoint; also
     * the correct hook for anyone bulk-editing grants outside the API.
     */
    public static function flushRoleCache(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    /**
     * @return array<string, list<string>>
     */
    private static function roleMap(): array
    {
        return self::query()
            ->join('role_permissions', 'role_permissions.permission_id', '=', 'permissions.id')
            ->get(['role_permissions.role', 'permissions.key'])
            ->groupBy('role')
            ->map(fn ($rows) => $rows->pluck('key')->values()->all())
            ->all();
    }
}
