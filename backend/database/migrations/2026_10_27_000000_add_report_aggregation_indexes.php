<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Indexes behind the Reports screen's aggregates.
 *
 * Each chart filters or joins on a column pair that had no index of its own,
 * so every load scanned whole tables (and, because the per-month vaccination
 * chart repeats its query twelve times, scanned them twelve times):
 *
 *  - monitoring status per animal: the compliance chart's EXISTS is keyed on
 *    (beneficiary_id, vaccination_date);
 *  - the animal-type donut reads monitoring rows by date only;
 *  - the compliance chart opens with "registered by month end", i.e. a
 *    created_at range over beneficiaries;
 *  - the dispersal charts join a beneficiary to events within a date window,
 *    which is (beneficiary_id, date_dispersed).
 *
 * Existing indexes are left alone; these only fill the gaps.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('monitoring_records', function (Blueprint $table): void {
            $table->index(['beneficiary_id', 'vaccination_date']);
            $table->index('date_monitored');
        });

        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->index('created_at');
            $table->index('animal_type');
        });

        Schema::table('dispersal_events', function (Blueprint $table): void {
            $table->index(['beneficiary_id', 'date_dispersed']);
        });
    }

    public function down(): void
    {
        Schema::table('monitoring_records', function (Blueprint $table): void {
            $table->dropIndex(['beneficiary_id', 'vaccination_date']);
            $table->dropIndex(['date_monitored']);
        });

        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->dropIndex(['created_at']);
            $table->dropIndex(['animal_type']);
        });

        Schema::table('dispersal_events', function (Blueprint $table): void {
            $table->dropIndex(['beneficiary_id', 'date_dispersed']);
        });
    }
};
