<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A technician's planned visit.
 *
 * This is deliberately separate from `field_visits`: a plan is work that has
 * not happened yet, while a field visit is the trip that was actually made
 * (with its evidence and GPS verdict). Completing a plan links it to the
 * existing visit record instead of copying that record here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('field_visit_plans', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('beneficiary_id')->constrained('beneficiaries')->cascadeOnDelete();
            $table->foreignId('technician_id')->constrained('users')->cascadeOnDelete();
            $table->date('planned_for');
            $table->string('purpose', 40);
            $table->string('status', 20)->default('pending');
            $table->text('notes')->nullable();
            $table->foreignId('field_visit_id')->nullable()
                ->constrained('field_visits')
                ->nullOnDelete();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['technician_id', 'planned_for', 'status'], 'fvp_tech_date_status');
            $table->index(['beneficiary_id', 'planned_for'], 'fvp_beneficiary_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('field_visit_plans');
    }
};
