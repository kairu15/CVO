<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Soft deletes for farmer deletion.
     *
     * Deleting a farmer from the admin Monitoring Records table used to remove
     * only the monitoring_records row, leaving the account, the household and
     * every clinical/visit/assignment row behind. The fix marks the whole
     * cluster deleted instead — LGU program data has retention requirements,
     * so nothing is physically removed and every list/query is expected to
     * hide the rows by default (Eloquent's SoftDeletes global scope).
     *
     * user_notifications deliberately has NO deleted_at column: its
     * `dedupe_key` is UNIQUE and the daily Smart Alerts scan re-inserts rows
     * by that key, so a soft-deleted row would collide with the re-insert.
     * Notifications are transient events (audited in activity_logs) and are
     * deleted outright when their farmer goes (see BeneficiaryService).
     */
    public function up(): void
    {
        $tables = [
            'users',
            'beneficiaries',
            'monitoring_records',
            'technician_assignments',
            'field_visits',
            'field_visit_photos',
            'health_records',
            'case_notes',
            'dispersal_events',
        ];

        foreach ($tables as $table) {
            Schema::table($table, function (Blueprint $blueprint): void {
                $blueprint->softDeletes();
            });
        }
    }

    public function down(): void
    {
        $tables = [
            'users',
            'beneficiaries',
            'monitoring_records',
            'technician_assignments',
            'field_visits',
            'field_visit_photos',
            'health_records',
            'case_notes',
            'dispersal_events',
        ];

        foreach ($tables as $table) {
            Schema::table($table, function (Blueprint $blueprint): void {
                $blueprint->dropSoftDeletes();
            });
        }
    }
};
