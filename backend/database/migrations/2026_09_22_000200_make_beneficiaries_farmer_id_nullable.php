<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Re-dispersal recipients may be registered before their farmer account
     * exists (the field technician records the household first), so
     * farmer_id is now nullable. The animal and its location are the primary
     * record; the owning account is linked once the recipient signs up.
     */
    public function up(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->foreignId('farmer_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->foreignId('farmer_id')->nullable(false)->change();
        });
    }
};
