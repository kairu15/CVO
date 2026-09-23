<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Technician field visits — the trip itself.
     *
     * Why this is not `monitoring_records` (which is also "a technician
     * visiting a beneficiary"):
     *
     *  - `monitoring_records` records ANIMAL CONDITION captured during a visit
     *    — body condition score, deworming, vaccination dates. It mirrors the
     *    CVO's monthly reporting sheet.
     *  - `field_visits` records THE TRIP — where the technician went, when,
     *    why, and a GPS fix proving they were there.
     *
     * A visit can produce no monitoring record at all: the technician drives
     * out, finds nobody home, and still made the trip and captured the
     * location. Storing that inside monitoring records would mean inventing a
     * fake animal observation just to log the journey.
     *
     * Deliberately no link to a monitoring record: a visit can yield zero or
     * several, and coupling the two would mean either table could not be
     * entered independently.
     */
    public function up(): void
    {
        Schema::create('field_visits', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('beneficiary_id')->constrained('beneficiaries')->cascadeOnDelete();
            $table->foreignId('technician_id')->constrained('users'); // who went
            $table->date('visited_on');
            $table->string('purpose', 40);

            // GPS fix captured on site, same precision as beneficiaries.
            // Nullable: a fix is not always available, and a visit without one
            // is still a visit.
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();

            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['technician_id', 'visited_on']);
            $table->index(['beneficiary_id', 'visited_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('field_visits');
    }
};
