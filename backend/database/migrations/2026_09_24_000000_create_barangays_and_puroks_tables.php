<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Official barangay coverage as first-class tables (seeded from
     * config/barangays.php), with puroks/sitios hanging off each barangay.
     * Beneficiaries point at both — the free-text `address` stays as the
     * synced display string so every existing reader keeps working.
     */
    public function up(): void
    {
        Schema::create('barangays', function (Blueprint $table): void {
            $table->id();
            $table->string('name')->unique();
            $table->decimal('latitude', 10, 7);
            $table->decimal('longitude', 10, 7);
            $table->timestamps();
        });

        Schema::create('puroks', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('barangay_id')->constrained('barangays')->cascadeOnDelete();
            $table->string('name');
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->boolean('is_placeholder')->default(false);
            $table->timestamps();

            $table->unique(['barangay_id', 'name']);
        });

        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->foreignId('barangay_id')->nullable()->after('address')->constrained('barangays');
            $table->foreignId('purok_id')->nullable()->after('barangay_id')->constrained('puroks');
        });
    }

    public function down(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('purok_id');
            $table->dropConstrainedForeignId('barangay_id');
        });

        Schema::dropIfExists('puroks');
        Schema::dropIfExists('barangays');
    }
};
