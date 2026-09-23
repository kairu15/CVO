<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * System settings — a deliberately tiny key-value store.
 *
 * Only the office contact profile lives here today (four named keys written by
 * SettingsService). Everything else that looks like a setting is deliberately
 * NOT here: the barangay list stays in config/cvo.php because beneficiary
 * addresses and validation normalize against it, and renaming a barangay in a
 * database would silently orphan every historical row that spells it the old
 * way. If this table ever needs more than a handful of named keys, that is
 * the point to ask whether a "settings framework" is actually wanted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settings', function (Blueprint $table): void {
            $table->id();
            $table->string('key')->unique();
            $table->text('value')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('settings');
    }
};
