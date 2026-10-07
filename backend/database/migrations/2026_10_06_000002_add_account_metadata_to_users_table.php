<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Per-account metadata the User Management screen shows:
     *
     * - `last_login_at` — stamped on every successful sign-in (session or
     *   token). Also queryable on the login rows in the activity log, but a
     *   column is what a table cell wants; the log is the history, this is
     *   the fact.
     * - `created_by` — which administrator created the account. Nullable:
     *   self-registered farmers have no creator.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->timestamp('last_login_at')->nullable()->after('password');
            $table->foreignId('created_by')
                ->nullable()
                ->after('role')
                ->constrained('users')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('created_by');
            $table->dropColumn('last_login_at');
        });
    }
};
