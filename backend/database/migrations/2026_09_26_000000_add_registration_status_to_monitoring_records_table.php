<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Registration lifecycle for auto-created monitoring records.
     *
     * When a farmer self-registers with dispersal details, a beneficiary and
     * its first monitoring record are created in the same transaction as the
     * account. The record starts as `new` so the admin sees it needs review,
     * becomes `accepted` when an admin accepts it, and `old` once its
     * midnight expiry passes (see the ExpireRegistrationRecords command).
     *
     * technician_id is made nullable: the auto-created record has no
     * technician visit behind it yet — a technician's first real visit fills
     * it in. Laravel 11+ applies ->change() natively (no doctrine/dbal).
     */
    public function up(): void
    {
        Schema::table('monitoring_records', function (Blueprint $table): void {
            // `none` = an ordinary technician-logged record that was never
            // part of a registration — it never shows a badge.
            $table->string('registration_status', 16)->default('none')->after('remarks');
            $table->timestamp('registered_at')->nullable()->after('registration_status');
            $table->timestamp('accepted_at')->nullable()->after('registered_at');
            $table->timestamp('status_expires_at')->nullable()->after('accepted_at');

            $table->index('registration_status');

            $table->foreignId('technician_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('monitoring_records', function (Blueprint $table): void {
            $table->dropIndex(['registration_status']);
            $table->dropColumn(['registration_status', 'registered_at', 'accepted_at', 'status_expires_at']);
        });

        // technician_id stays nullable on rollback — undoing a nullability
        // change would fail on the auto-created rows that legitimately have
        // no technician yet.
    }
};
