<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Security audit trail — who did what, to what, from where, when.
     *
     * Append-only by policy: the application never UPDATEs or DELETEs rows
     * here (see AuditLogger), and the read endpoint is admin-only. Rows carry
     * the actor's role AT THE TIME of the action — role changes are themselves
     * audited, so a historical row must not silently change meaning after the
     * fact.
     */
    public function up(): void
    {
        Schema::create('activity_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('actor_id')->nullable()->index()
                ->comment('users.id — null for pre-auth events (failed login of an unknown account)');
            $table->string('actor_role', 20)->nullable()
                ->comment('The actor\'s role at action time');
            $table->string('action', 64)->index()
                ->comment('Vocabulary in App\Models\ActivityLog::ACTIONS');
            $table->string('target_type', 64)->nullable();
            $table->unsignedBigInteger('target_id')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 500)->nullable();
            $table->jsonb('context')->nullable()
                ->comment('Action-specific details (e.g. failed attempts count, previous role)');
            $table->timestamp('created_at')->useCurrent()->index()
                ->comment('Event time; immutable by design (no updated_at)');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_logs');
    }
};
