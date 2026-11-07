<?php

use App\Models\Permission;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The system has exactly two roles from here on: `admin` and `technician`.
 * There is no separate `doctor` role — the technician covers the field work
 * AND the clinical record-keeping, so every doctor capability moves onto the
 * technician role and every doctor account becomes a technician.
 *
 * WHY THIS IS A DATA MIGRATION AND NOT A RE-CATALOG
 * -------------------------------------------------
 * The capability matrix (`role_permissions`) is live data an administrator
 * edits on the Roles & Permissions screen: a fresh install re-seeds it from
 * the historical migrations, but an existing database carries any custom
 * grants made since. So instead of re-running a catalog, this migration
 * merges whatever the `doctor` role currently holds into `technician`:
 *
 *  1. Copies every `doctor` grant onto `technician` (insert-or-ignore — the
 *     unique [role, permission_id] index makes the copy idempotent). This is
 *     what hands the technician the two capabilities that used to be
 *     doctor-only: `health_records.create` and `case_notes.create`. Grants
 *     the technician already had (monitoring.update, view_flight_path,
 *     view_analytics, the *.view keys) are left untouched.
 *  2. Converts the `doctor` accounts to `technician` — the sign-in keeps
 *     working and stays the author of its health records and case notes
 *     (doctor_id on those tables is the attending veterinarian, which is
 *     record authorship, not a role assignment).
 *  3. Deletes the now-empty `doctor` grants from the matrix.
 *
 * Admin-only capabilities (manage_users, monitoring.set-moa,
 * void_dispersal_event, ...) are NOT copied — the doctor never held them.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. Hand every capability the doctor role holds to the technician.
        //    insertOrIgnore skips pairs the technician already has.
        $now = now();

        $doctorGrants = DB::table('role_permissions')
            ->where('role', 'doctor')
            ->get(['permission_id']);

        DB::table('role_permissions')->insertOrIgnore(
            $doctorGrants->map(fn (object $grant): array => [
                'role' => 'technician',
                'permission_id' => $grant->permission_id,
                'created_at' => $now,
                'updated_at' => $now,
            ])->all(),
        );

        // 2. Every doctor account becomes a technician. Clinical authorship
        //    survives: health_records.doctor_id / case_notes.doctor_id keep
        //    pointing at the same user id, now signed in with the technician
        //    role.
        DB::table('users')->where('role', 'doctor')->update([
            'role' => 'technician',
            'updated_at' => $now,
        ]);

        // 3. The role is gone, so its capability grants are gone too.
        DB::table('role_permissions')->where('role', 'doctor')->delete();

        Permission::flushRoleCache();
    }

    /**
     * Best effort: re-creates the `doctor` grants from the merged technician
     * rows (the technician keeps its own grants — they overlap by design),
     * but the converted accounts stay technicians — a one-way data change by
     * design.
     */
    public function down(): void
    {
        $now = now();

        $technicianGrants = DB::table('role_permissions')
            ->where('role', 'technician')
            ->get(['permission_id']);

        DB::table('role_permissions')->insertOrIgnore(
            $technicianGrants->map(fn (object $grant): array => [
                'role' => 'doctor',
                'permission_id' => $grant->permission_id,
                'created_at' => $now,
                'updated_at' => $now,
            ])->all(),
        );

        Permission::flushRoleCache();
    }
};
