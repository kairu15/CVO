<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Admin-editable lookup table for the Rule-Based Health Concern Hints.
     *
     * Each row is a plain keyword match: when a doctor types a note, the entry
     * form looks for any of `keywords` in the text and shows `hint` as a
     * decision-support reminder. It is deliberately a TABLE, not a hardcoded
     * PHP array — the CVO's veterinarian must be able to add or correct a rule
     * without a code change, which is what makes this useful beyond a demo.
     *
     * `animal_type` null means the rule applies to every species; set, it only
     * offers on records for that type. `keywords` is JSON so a rule can carry
     * a synonym list (the form matches on any of them); a multi-word entry is
     * a phrase match, which is how combinations like "loss of appetite" are
     * expressed. Nothing here is a model or a learned value.
     */
    public function up(): void
    {
        Schema::create('symptom_rules', function (Blueprint $table): void {
            $table->id();
            // Short, human name for the rule, e.g. "Digestive upset".
            $table->string('label', 120);
            // Synonym list; the form matches if the note contains ANY entry.
            $table->json('keywords');
            // The plain-language "consider checking for..." line. Explicitly a
            // decision-support prompt, never a diagnosis.
            $table->text('hint');
            // Optional species scope; null = all animal types.
            $table->string('animal_type', 50)->nullable();
            // Admins retire a rule instead of deleting it when unsure.
            $table->boolean('is_active')->default(true);
            // Display order, lowest first.
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(['is_active', 'sort_order']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('symptom_rules');
    }
};
