<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Barangay dispersal analytics capability for the Roles & Permissions matrix.
 *
 * Added as data (the catalog is admin-editable) rather than as a code change,
 * exactly like every other capability — same pattern as the ownership
 * permissions migration this mirrors.
 *
 * A NEW key instead of reusing `view_reports` on purpose: view_reports is
 * seeded admin-only (RolesPermissionsTest pins that), and granting it to
 * doctors and technicians to open the analytics would silently open the
 * whole program-report module too. The access rule for this feature is
 * narrower — admin/doctor see everything, technicians see the same views
 * row-scoped to their assigned households in the query layer — so it gets
 * its own grant the office can tune without touching the reports one.
 */
return new class extends Migration
{
    private const CATALOG = [
        ['view_analytics', 'View barangay dispersal and re-dispersal analytics', ['admin', 'doctor', 'technician']],
    ];

    private const GROUP = 'Reports';

    public function up(): void
    {
        $now = now();
        $sort = (int) DB::table('permissions')->where('group', self::GROUP)->max('sort_order');

        foreach (self::CATALOG as [$key, $label, $roles]) {
            // Idempotent: a re-run (or a hand-added key) must not duplicate.
            if (DB::table('permissions')->where('key', $key)->exists()) {
                continue;
            }

            $permissionId = DB::table('permissions')->insertGetId([
                'key' => $key,
                'label' => $label,
                'group' => self::GROUP,
                'sort_order' => ++$sort,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            DB::table('role_permissions')->insert(
                collect($roles)->map(fn (string $role): array => [
                    'role' => $role,
                    'permission_id' => $permissionId,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all(),
            );
        }

        // The matrix is cached process-wide (Permission::CACHE_KEY); a fresh
        // grant must not wait for a cache expiry to take effect.
        \App\Models\Permission::flushRoleCache();
    }

    public function down(): void
    {
        $ids = DB::table('permissions')
            ->whereIn('key', array_column(self::CATALOG, 0))
            ->pluck('id');

        DB::table('role_permissions')->whereIn('permission_id', $ids)->delete();
        DB::table('permissions')->whereIn('key', $ids)->delete();

        \App\Models\Permission::flushRoleCache();
    }
};
