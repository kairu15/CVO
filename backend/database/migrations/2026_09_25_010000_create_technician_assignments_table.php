<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Audit trail for technician-to-farmer assignments.
     *
     * The ACTIVE assignment stays on beneficiaries.technician_id (one active
     * technician per beneficiary — every scoping query in the app reads that
     * column). This table records every change: a row is appended when a
     * technician is assigned, superseded (reassigned to someone else), or
     * cleared. Nothing is ever hard-deleted, so the office can reconstruct
     * who was responsible for a household on any given date.
     */
    public function up(): void
    {
        Schema::create('technician_assignments', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('beneficiary_id')->constrained('beneficiaries')->cascadeOnDelete();
            $table->foreignId('technician_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('assigned_by')->constrained('users')->cascadeOnDelete();
            $table->timestamp('assigned_at');

            // The assignment state this row superseded, kept so the history
            // reads as a chain (null = the beneficiary had no technician).
            $table->foreignId('previous_technician_id')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            $table->index(['beneficiary_id', 'assigned_at']);
            $table->index('technician_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('technician_assignments');
    }
};
