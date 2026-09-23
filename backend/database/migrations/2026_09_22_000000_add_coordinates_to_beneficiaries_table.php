<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Geo-tagging: every dispersed animal is pinned to the barangay/sitio it
     * was delivered to. Coordinates are nullable — existing rows without a
     * field fix are still valid, and the map simply omits them until the next
     * visit captures a position.
     */
    public function up(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->decimal('latitude', 10, 7)->nullable()->after('address');
            $table->decimal('longitude', 10, 7)->nullable()->after('latitude');

            $table->index(['latitude', 'longitude']);
        });
    }

    public function down(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->dropIndex(['latitude', 'longitude']);
            $table->dropColumn(['latitude', 'longitude']);
        });
    }
};
