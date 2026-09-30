<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Idempotency key for the Smart Alerts scan.
     *
     * Ordinary event notifications leave this null (they fire once, at the
     * moment the event happens). Smart Alerts re-derive the same fact every
     * day, so they need a stable identity to update-or-create against —
     * otherwise a daily job would pile up an identical row per recipient per
     * day. The key is scoped to the recipient because a notification is
     * per-user by definition, e.g. `smart-vaccination-overdue:u7:b42`.
     *
     * Nullable on purpose: a unique index tolerates many nulls on both MySQL
     * and SQLite, so the existing event notifications are unaffected.
     */
    public function up(): void
    {
        Schema::table('user_notifications', function (Blueprint $table): void {
            $table->string('dedupe_key', 120)->nullable()->unique()->after('link');
        });
    }

    public function down(): void
    {
        Schema::table('user_notifications', function (Blueprint $table): void {
            $table->dropUnique(['dedupe_key']);
            $table->dropColumn('dedupe_key');
        });
    }
};
