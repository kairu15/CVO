<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Veterinary announcements — the "Featured veterinary announcements" block on
 * the public landing page (advisories, outreach schedules, program notices).
 *
 * Deliberately tiny: a title, a body, a pin flag and a publish timestamp.
 * `published_at` null means DRAFT — written by the admin, not yet public.
 * There is no authoring workflow beyond that on purpose: one office, one
 * editor, no revision history. If announcements ever need categories or
 * expiry dates, that is the point to ask for a small content framework.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('announcements', function (Blueprint $table): void {
            $table->id();
            $table->string('title', 200);
            $table->text('body');
            $table->boolean('is_pinned')->default(false);
            // null = draft (never public); set = the moment it went live.
            // Pinned rows float above the newest-first list.
            $table->timestamp('published_at')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('announcements');
    }
};
