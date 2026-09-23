<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The livestock pass-on chain: an initial dispersal delivers an animal to
     * a beneficiary; when that animal produces offspring, a re-dispersal moves
     * the offspring on to a new beneficiary. Each row is one link in that
     * chain, so walking `parent_beneficiary_id` from any row reconstructs the
     * lineage of the animal being monitored.
     *
     * `new_beneficiary_id` points at the beneficiary row created for a brand
     * new recipient at re-dispersal time; it stays null when the offspring was
     * handed to an already-registered beneficiary.
     */
    public function up(): void
    {
        Schema::create('dispersal_events', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('beneficiary_id')->constrained('beneficiaries')->cascadeOnDelete();
            $table->foreignId('parent_beneficiary_id')
                ->nullable()
                ->constrained('beneficiaries')
                ->nullOnDelete();
            $table->foreignId('new_beneficiary_id')
                ->nullable()
                ->constrained('beneficiaries')
                ->nullOnDelete();
            $table->enum('dispersal_type', ['initial', 're-dispersal']);
            $table->date('date_dispersed')->nullable();
            $table->text('remarks')->nullable();
            $table->timestamps();

            $table->index(['dispersal_type', 'date_dispersed']);
            $table->index('parent_beneficiary_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dispersal_events');
    }
};
