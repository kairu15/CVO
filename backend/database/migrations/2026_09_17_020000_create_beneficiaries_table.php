<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Beneficiaries are the dispersed animals and the households that received
     * them. The farmer's identity fields (name, address, animal type, sex) are
     * captured once here and flow read-only into every monitoring record.
     */
    public function up(): void
    {
        Schema::create('beneficiaries', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('farmer_id')->constrained('users');
            $table->string('name_of_farmer');
            $table->string('address'); // barangay/sitio
            $table->string('animal_type');
            $table->enum('sex', ['M', 'F']);
            $table->foreignId('technician_id')->nullable()->constrained('users');
            $table->timestamps();

            $table->index('address');
            $table->index('technician_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('beneficiaries');
    }
};
