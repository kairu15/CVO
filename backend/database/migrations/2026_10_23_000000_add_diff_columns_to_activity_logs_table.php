<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Before/after values behind the audit trail's expandable diff (item 8 —
     * system-wide audit trail).
     *
     * Both are nullable: a create has no `old_values`, a delete no
     * `new_values`, and rows written before this migration simply stay NULL.
     * Only CHANGED fields are stored (see App\Models\Concerns\Auditable), and
     * sensitive identifiers are masked on the way in (App\Support\SensitiveMask)
     * — the stored row is the same masked shape the UI shows.
     *
     * The extra index feeds the entity-type filter on the audit page; every
     * other filter (action, actor, dates) was already indexed in
     * create_activity_logs_table.
     */
    public function up(): void
    {
        Schema::table('activity_logs', function (Blueprint $table): void {
            $table->jsonb('old_values')->nullable()
                ->comment('Values before the change — only the fields that changed');
            $table->jsonb('new_values')->nullable()
                ->comment('Values after the change — only the fields that changed');
            $table->index('target_type', 'activity_logs_target_type_index');
        });
    }

    public function down(): void
    {
        Schema::table('activity_logs', function (Blueprint $table): void {
            $table->dropIndex('activity_logs_target_type_index');
            $table->dropColumn(['old_values', 'new_values']);
        });
    }
};
