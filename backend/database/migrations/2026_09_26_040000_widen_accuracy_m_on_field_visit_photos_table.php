<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * accuracy_m held decimal(6,2) — at most 9999.99 — but the API accepts
     * network-location fixes up to 100000 m (a city-wide uncertainty circle),
     * so real uploads failed with "Out of range value". Widen to hold every
     * value the validation layer allows.
     */
    public function up(): void
    {
        Schema::table('field_visit_photos', function (Blueprint $table): void {
            $table->decimal('accuracy_m', 8, 2)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('field_visit_photos', function (Blueprint $table): void {
            $table->decimal('accuracy_m', 6, 2)->nullable()->change();
        });
    }
};
