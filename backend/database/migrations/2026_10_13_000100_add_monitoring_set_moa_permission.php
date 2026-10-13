<?php

use App\Models\Permission;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A dedicated capability for flipping a dispersal's MOA status from the
 * monitoring table.
 *
 * The matrix gates CAPABILITIES, and this one is admin-only by seed — the
 * same shape as the other admin-oversight monitoring capability
 * (`monitoring.accept-registration`). Making it a grant rather than a hard
 * role check keeps "admin only" visible on the Roles & Permissions screen,
 * so the program rules can be adjusted there without a deploy.
 *
 * sort_order 5 lands it directly after accept-registration in the
 * "Monitoring records" group.
 */
return new class extends Migration
{
    private const KEY = 'monitoring.set-moa';

    public function up(): void
    {
        $now = now();

        $permissionId = DB::table('permissions')->insertGetId([
            'key' => self::KEY,
            'label' => 'Set MOA status',
            'group' => 'Monitoring records',
            'sort_order' => 5,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::table('role_permissions')->insert([
            'role' => 'admin',
            'permission_id' => $permissionId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        // The role → keys map is cached forever; a grant inserted outside the
        // matrix API must not be invisible to a worker that already read it.
        Permission::flushRoleCache();
    }

    public function down(): void
    {
        $permissionId = DB::table('permissions')->where('key', self::KEY)->value('id');

        if ($permissionId !== null) {
            DB::table('role_permissions')->where('permission_id', $permissionId)->delete();
            DB::table('permissions')->where('id', $permissionId)->delete();
        }

        Permission::flushRoleCache();
    }
};
