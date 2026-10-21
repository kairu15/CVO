<?php

use App\Models\Permission;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Beneficiaries become the standalone program record; farmer login accounts
 * and the self-registration review lifecycle go away.
 *
 * WHY THIS IS A DATA MIGRATION AND NOT A DROP
 * -------------------------------------------
 * `beneficiaries` has always held the real program data — the farmer identity
 * (name_of_farmer, address, animal_type, sex, rsbsa_number, moa_signed) and
 * the location. `users.farmer_id` was only a link to a login account. Removing
 * that link therefore loses NOTHING: every existing farmer's recorded animal,
 * address, monitoring history and dispersal chain stays on its beneficiary
 * row, which is what the admin Beneficiaries screen and every report read.
 *
 * What this migration does, in order:
 *  1. Soft-deletes the `farmer` accounts (rows preserved for audit) and ends
 *     any sessions/tokens they still hold, so no farmer can keep signing in.
 *  2. Points the `users.role` column default away from the removed role —
 *     it still defaulted to `farmer` (set when "member" became "farmer"),
 *     which would let a raw insert that forgot `role` resurrect an account
 *     the system no longer recognises.
 *  3. Drops the now-meaningless `farmer` grants from the capability matrix.
 *  4. Drops `beneficiaries.farmer_id` — with no accounts, the beneficiary row
 *     IS the record.
 *  5. Drops the New/Old registration lifecycle columns from
 *     `monitoring_records`: they existed only to review public self-signups,
 *     and an admin entering a beneficiary is asserting it is real, so there is
 *     nothing left to accept.
 *
 * technician_assignments already points at `beneficiaries`, so it keeps
 * working unchanged.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. Retire the farmer accounts without destroying the history that
        //    references them (audit actors, authored rows). A soft delete is
        //    the same lifecycle User Management already uses for staff.
        $farmerIds = DB::table('users')->where('role', 'farmer')->pluck('id');

        if ($farmerIds->isNotEmpty()) {
            DB::table('personal_access_tokens')
                ->where('tokenable_type', 'App\\Models\\User')
                ->whereIn('tokenable_id', $farmerIds)
                ->delete();

            DB::table('sessions')->whereIn('user_id', $farmerIds)->delete();

            DB::table('users')
                ->whereIn('id', $farmerIds)
                ->update(['deleted_at' => now()->toDateTimeString()]);
        }

        // 2. The column default still named the removed role. Every real
        //    write passes an explicit role (User::ROLES has no `farmer`), so
        //    the default is only a safety net — and it must never be the role
        //    that no longer exists. `technician` is a valid staff value that
        //    the capability matrix scopes to "assigned only" (i.e. nothing
        //    until someone is assigned), so a forgotten `role` cannot leak.
        //    (DEFAULT NULL is not an option: the column is NOT NULL and
        //    MySQL rejects a NULL default on it.)
        Schema::table('users', function (Blueprint $table): void {
            $table->string('role', 20)->default('technician')->change();
        });

        // 3. The role is gone, so its capability grants are gone too.
        DB::table('role_permissions')->where('role', 'farmer')->delete();

        // 4. With no login accounts there is nothing for a beneficiary to
        //    belong to; the beneficiary row is the record of its own.
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('farmer_id');
        });

        // 5. The accept/New-Old lifecycle reviewed self-registrations.
        //    The status column carries an index added alongside it; drop the
        //    index first (SQLite refuses to drop an indexed column otherwise).
        Schema::table('monitoring_records', function (Blueprint $table): void {
            $table->dropIndex(['registration_status']);
        });

        Schema::table('monitoring_records', function (Blueprint $table): void {
            $table->dropColumn([
                'registration_status',
                'registered_at',
                'accepted_at',
                'status_expires_at',
            ]);
        });

        Permission::flushRoleCache();
    }

    /**
     * Best effort: the schema can be restored, but the retired accounts are
     * only un-trashed, not re-linked, since the link was the thing removed.
     * This is a one-way data change by design.
     */
    public function down(): void
    {
        Schema::table('monitoring_records', function (Blueprint $table): void {
            $table->string('registration_status', 16)->default('none')->after('remarks');
            $table->timestamp('registered_at')->nullable();
            $table->timestamp('accepted_at')->nullable();
            $table->timestamp('status_expires_at')->nullable();

            $table->index('registration_status');
        });

        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->foreignId('farmer_id')->nullable()->after('id')->constrained('users');
        });

        DB::table('users')->where('role', 'farmer')->update(['deleted_at' => null]);

        Schema::table('users', function (Blueprint $table): void {
            $table->string('role', 20)->default('farmer')->change();
        });

        Permission::flushRoleCache();
    }
};
