<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Freeform veterinary case notes.
     *
     * Where this sits, so it does not blur into the tables either side of it:
     *
     *  - `monitoring_records` — the technician's monthly visit log (the CVO
     *    Excel workbook), with structured visit fields.
     *  - `health_records`    — a discrete clinical event: a required diagnosis,
     *    optional treatment and an outcome. Authored by a vet.
     *  - `case_notes`        — a dated observation with no diagnosis attached.
     *    "Owner phoned — animal still limping", "Referred to the provincial
     *    vet", "Advised to isolate the rest of the herd".
     *
     * The distinction that keeps the last two apart: a note must NOT require a
     * diagnosis to be worth recording. If a note is really a diagnosis, it
     * belongs in Health Records instead — otherwise the animal's clinical
     * history ends up split across two screens and neither is complete.
     *
     * Deliberately no follow-up date column: due dates are the Vaccination
     * Schedule's job, and a second source of them would drift.
     */
    public function up(): void
    {
        Schema::create('case_notes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('beneficiary_id')->constrained('beneficiaries')->cascadeOnDelete();
            $table->foreignId('doctor_id')->constrained('users'); // who wrote it
            $table->date('date_noted');
            $table->text('body');
            $table->timestamps();

            $table->index(['beneficiary_id', 'date_noted']);
            $table->index(['doctor_id', 'date_noted']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('case_notes');
    }
};
