<?php

use App\Models\Permission;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Drop the "accept registration-created records" capability.
 *
 * The New/Old monitoring lifecycle it guarded was removed with public
 * self-registration: an administrator entering a beneficiary is asserting the
 * household is enrolled, so there is no pending state left to accept. Leaving
 * the capability in the matrix would advertise a permission that no endpoint
 * checks and no screen can exercise.
 *
 * `role_permissions` rows cascade with the permission row (see the FK in
 * 2026_10_06_000001_create_permissions_tables).
 */
return new class extends Migration
{
    private const KEY = 'monitoring.accept-registration';

    public function up(): void
    {
        DB::table('permissions')->where('key', self::KEY)->delete();

        Permission::flushRoleCache();
    }

    public function down(): void
    {
        $permissionId = DB::table('permissions')->insertGetId([
            'key' => self::KEY,
            'label' => 'Accept registration-created records',
            'group' => 'Monitoring records',
            'sort_order' => 4,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('role_permissions')->insert([
            'role' => 'admin',
            'permission_id' => $permissionId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Permission::flushRoleCache();
    }
};
