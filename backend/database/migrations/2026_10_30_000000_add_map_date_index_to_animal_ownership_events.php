<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The dispersal map's date selector scans the ownership log by DAY — "which
 * dates have active events, and how many" — before any event row is read.
 * The analytics index (event_type, event_date, …) leads with event_type, so
 * a pure date scan cannot use it; this index lets the grouped date query be
 * one index range scan per status instead of a table walk.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('animal_ownership_events', function (Blueprint $table): void {
            $table->index(['status', 'event_date'], 'aoe_status_date_idx');
        });
    }

    public function down(): void
    {
        Schema::table('animal_ownership_events', function (Blueprint $table): void {
            $table->dropIndex('aoe_status_date_idx');
        });
    }
};
