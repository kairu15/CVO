<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Barangay snapshots on the append-only ownership events, so per-barangay
 * dispersal analytics is answered from what was true WHEN the handover
 * happened rather than from each beneficiary's barangay today — an owner
 * edited onto a different barangay must never silently rewrite history.
 *
 * The columns are written by AnimalDispersalService at event time and
 * backfilled for existing events by `ownership:backfill-barangays`
 * (idempotent, `--dry-run`, reports rows whose household has no barangay).
 * NULL means the side was CVO (no barangay) or the household has none on
 * record — analytics treats that as "unknown origin", never as a barangay.
 *
 * `barangays.population` powers the optional per-1,000 residents view.
 * Nullable and empty by default: the CVO supplies verified figures, the
 * system never invents them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('animal_ownership_events', function (Blueprint $table): void {
            $table->foreignId('from_barangay_id')
                ->nullable()
                ->after('from_beneficiary_id')
                ->constrained('barangays')
                ->nullOnDelete();
            $table->foreignId('to_barangay_id')
                ->nullable()
                ->after('to_beneficiary_id')
                ->constrained('barangays')
                ->nullOnDelete();

            // The analytics read: one range scan per (type, date window),
            // carrying both ends of the flow. Named explicitly so the
            // migration stays re-runnable alongside the unnamed defaults.
            $table->index(
                ['event_type', 'event_date', 'from_barangay_id', 'to_barangay_id'],
                'aoe_type_date_barangays_idx',
            );
        });

        Schema::table('barangays', function (Blueprint $table): void {
            $table->unsignedInteger('population')->nullable()->after('longitude');
        });
    }

    public function down(): void
    {
        Schema::table('barangays', function (Blueprint $table): void {
            $table->dropColumn('population');
        });

        Schema::table('animal_ownership_events', function (Blueprint $table): void {
            $table->dropIndex('aoe_type_date_barangays_idx');
            $table->dropConstrainedForeignId('from_barangay_id');
            $table->dropConstrainedForeignId('to_barangay_id');
        });
    }
};
