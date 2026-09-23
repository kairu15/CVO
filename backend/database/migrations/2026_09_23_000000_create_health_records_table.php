<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Clinical health records authored by a veterinarian.
     *
     * Deliberately separate from `monitoring_records`: those rows are the
     * monthly CVO reporting workbook (visits, deworming, body condition score)
     * and are imported verbatim from the office's own Excel template. A
     * diagnosis and its treatment are a different thing with a different
     * author, so neither table has to bend to hold the other's shape.
     */
    public function up(): void
    {
        Schema::create('health_records', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('beneficiary_id')->constrained('beneficiaries')->cascadeOnDelete();
            $table->foreignId('doctor_id')->constrained('users'); // the attending veterinarian
            $table->date('date_recorded');
            $table->string('diagnosis');
            $table->text('treatment')->nullable();

            // Stored as a string rather than a DB enum: the vocabulary lives in
            // config/cvo.php so adding an outcome is a one-line change instead
            // of an ALTER TABLE. (beneficiaries.sex needed a follow-up
            // migration to become nullable — enums are cheap to add and
            // awkward to revise.)
            $table->string('outcome', 30)->nullable();

            $table->text('remarks')->nullable();
            $table->timestamps();

            $table->index(['beneficiary_id', 'date_recorded']);
            $table->index(['doctor_id', 'date_recorded']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('health_records');
    }
};
