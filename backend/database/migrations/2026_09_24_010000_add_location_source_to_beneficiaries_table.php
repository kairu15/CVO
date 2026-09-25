<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Record HOW a beneficiary's location was captured — gps fix, map pin,
     * or a manual dropdown choice — so staff can judge data quality later:
     * a GPS-confirmed point is worth more than a barangay picked by name.
     */
    public function up(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->string('location_source', 20)->default('manual')->after('longitude');
        });
    }

    public function down(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->dropColumn('location_source');
        });
    }
};
