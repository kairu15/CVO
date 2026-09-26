<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Stored, per-user event notifications.
     *
     * Distinct from the derived feed (NotificationService's vaccination and
     * dispersal alerts, computed from records at read time): these rows are
     * EVENTS — "a farmer registered", "your assignment changed" — that have
     * no backing record to re-derive from and must persist per recipient
     * with read/unread state. That is the point at which the notification
     * module's own docblock said it would stop being derived and become
     * data.
     */
    public function up(): void
    {
        Schema::create('user_notifications', function (Blueprint $table): void {
            $table->id();
            // The recipient — notifications are per-user, full stop.
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            // The actor, when the event has one (the admin who accepted, the
            // technician who visited) — for wording like "Jun accepted…".
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            // Optional subject rows, so a click can navigate to the record.
            $table->foreignId('beneficiary_id')->nullable()->constrained('beneficiaries')->nullOnDelete();
            $table->foreignId('monitoring_record_id')->nullable()->constrained('monitoring_records')->nullOnDelete();

            // Event vocabulary, e.g. registration-new, registration-accepted,
            // technician-assigned, field-visit-photo. Validated in the model.
            $table->string('type', 40);
            $table->string('title');
            $table->text('message');
            // Where a click should land, role-dependent — resolved at creation.
            $table->string('link')->nullable();

            // Read/unread is the whole point of this table.
            $table->timestamp('read_at')->nullable();

            $table->timestamps();

            $table->index(['user_id', 'read_at']);
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_notifications');
    }
};
