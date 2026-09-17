<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Monthly monitoring visits. The farmer identity columns live on the
     * beneficiary and are joined at read time — they are never duplicated here.
     */
    public function up(): void
    {
        Schema::create('monitoring_records', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('beneficiary_id')->constrained('beneficiaries');
            $table->foreignId('technician_id')->constrained('users'); // who logged this visit
            $table->date('date_monitored')->nullable();
            $table->date('date_vits_supp')->nullable();
            $table->date('deworming_date')->nullable();
            $table->date('vaccination_date')->nullable();
            $table->date('date_breed')->nullable();
            $table->date('date_calved')->nullable();
            $table->unsignedTinyInteger('bcs')->nullable(); // Body Condition Score 1-5
            $table->string('farmers_signature')->nullable(); // signature image path or typed confirmation
            $table->text('remarks')->nullable();
            $table->timestamps();

            $table->index(['beneficiary_id', 'date_monitored']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('monitoring_records');
    }
};
