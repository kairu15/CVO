<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Offline sync conflicts.
     *
     * When a queued offline write would overwrite a record that changed on the
     * server since the item was queued, the resolution is last-write-wins —
     * but NEVER silently. This table is the "never silently" half: an admin
     * can see that a conflict happened, who was involved, which side won, and
     * when.
     *
     * Deliberately a log, not a merge engine: it records the decision the
     * technician made ("overwrite" or "keep the server's version"), it does not
     * re-apply anything. The queued item itself carries the payload.
     */
    public function up(): void
    {
        Schema::create('sync_conflicts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained('users'); // who was syncing
            $table->string('entity_type', 40); // field_visit | case_note
            $table->unsignedBigInteger('entity_id'); // the server record that changed
            $table->string('kind', 40); // the queue kind (field-visit, case-note…)

            // When the offline item was queued (client clock) vs when the
            // server record was last written. Kept as plain timestamps rather
            // than a diff because the raw pair is what an audit reader needs.
            $table->timestamp('queued_at')->nullable();
            $table->timestamp('server_updated_at')->nullable();

            $table->string('resolution', 20); // overwrite | keep_server
            $table->string('summary')->nullable();

            $table->timestamps();

            $table->index(['entity_type', 'entity_id']);
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_conflicts');
    }
};
