<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Presence tracking for the User Management screen.
     *
     * `last_seen_at` is refreshed by App\Http\Middleware\TrackUserActivity on
     * authenticated requests (throttled to once a minute) and by the SPA's
     * heartbeat, so it measures ongoing activity rather than only the moment
     * of login. Indexed because the list query filters on it.
     *
     * `last_logout_at` is the "signed out" stamp: presence is
     * `last_seen_at` within the window AND (no logout OR last_logout_at <
     * last_seen_at). Keeping the last-seen value intact (instead of nulling
     * it) is what lets the table still say "Last seen 2 d ago" after a
     * sign-out. See App\Support\Presence for the single rule.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->timestamp('last_seen_at')->nullable()->after('last_login_at')->index();
            $table->timestamp('last_logout_at')->nullable()->after('last_seen_at');
        });

        // Backfill so every existing account is not "never seen": the login
        // stamp is the best activity evidence a pre-presence row has.
        DB::table('users')
            ->whereNotNull('last_login_at')
            ->update(['last_seen_at' => DB::raw('last_login_at')]);
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropIndex(['last_seen_at']);
            $table->dropColumn(['last_seen_at', 'last_logout_at']);
        });
    }
};
