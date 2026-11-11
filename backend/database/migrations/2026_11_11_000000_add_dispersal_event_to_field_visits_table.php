<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Optional link from a trip to the dispersal it followed up on.
 *
 * A visit already points at the household (`beneficiary_id`), but the
 * household may have received several animals over time. When the purpose is
 * a dispersal follow-up, recording WHICH dispersal answers "which delivery
 * did this visit check on?" without guessing from dates, and makes a
 * follow-up gap queryable.
 *
 * Nullable on purpose: most trips are routine monitoring, not dispersal
 * follow-ups, and historical rows have nothing to backfill.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('field_visits', function (Blueprint $table): void {
            $table->foreignId('dispersal_event_id')
                ->nullable()
                ->after('beneficiary_id')
                ->constrained('dispersal_events')
                ->nullOnDelete();

            $table->index(['dispersal_event_id', 'visited_on'], 'field_visits_dispersal_visited_index');
        });
    }

    public function down(): void
    {
        Schema::table('field_visits', function (Blueprint $table): void {
            $table->dropIndex('field_visits_dispersal_visited_index');
            $table->dropConstrainedForeignId('dispersal_event_id');
        });
    }
};
