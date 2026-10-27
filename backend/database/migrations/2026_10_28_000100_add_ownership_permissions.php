<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Ownership-chain capabilities for the Roles & Permissions matrix.
 *
 * Added as data (the catalog is admin-editable) rather than as a code change,
 * so the grants can be re-tuned from the Roles & Permissions screen without a
 * deploy — exactly like every other capability. The seeded grants reproduce
 * the rule in the brief: an administrator may always record, a technician may
 * record for the households assigned to them (row scope enforced in
 * AnimalDispersalService, not here), and only an administrator may void.
 */
return new class extends Migration
{
    /** @var list<array{0: string, 1: string, 2: list<string>}> */
    private const CATALOG = [
        ['manage_dispersal', 'Record initial dispersals and pass on animals', ['admin', 'technician']],
        ['manage_redispersal', 'Re-disperse an animal or return it to CVO', ['admin', 'technician']],
        ['void_dispersal_event', 'Void an ownership event and recompute the chain', ['admin']],
        ['view_flight_path', "View an animal's ownership chain and flight path", ['admin', 'doctor', 'technician']],
    ];

    private const GROUP = 'Dispersals';

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
        $keys = array_column(self::CATALOG, 0);

        $ids = DB::table('permissions')->whereIn('key', $keys)->pluck('id');

        DB::table('role_permissions')->whereIn('permission_id', $ids)->delete();
        DB::table('permissions')->whereIn('key', $keys)->delete();

        \App\Models\Permission::flushRoleCache();
    }
};
