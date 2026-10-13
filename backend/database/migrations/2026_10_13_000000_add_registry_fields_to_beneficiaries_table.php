<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Registry and agreement fields for the dispersed animal / household.
 *
 * RSBSA # is the farmer's national registry ID (Registry System for Basic
 * Sectors in Agriculture). It is a person-level identifier, but the farmer's
 * identity already lives denormalized on this row (name_of_farmer, address,
 * animal_type, sex — captured once and read-only into every monitoring
 * record), so it belongs here beside the name rather than on the monitoring
 * record, which changes per visit.
 *
 * MOA status is the signed Memorandum of Agreement for the dispersal — an
 * agreement PER DISPERSAL, so it lives on this animal/household row rather
 * than once per farmer account: a farmer who re-enrolls for a second animal
 * can carry a fresh agreement. Tri-state on purpose (null = not yet
 * recorded, true = signed, false = not signed) so a blank reads as "not on
 * file" instead of a misleading "No".
 *
 * Ear Tag # is the human-readable number printed on the physical tag (the QR
 * on the tag card is derived from the beneficiary id). Nullable and
 * deliberately NOT unique yet: most historical rows carry no tag and tags
 * are still being issued, so a uniqueness constraint now would only reject
 * legitimate data.
 *
 * All three are nullable — existing, imported and historical rows were
 * captured before these fields existed and are never backfilled with a guess.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->string('rsbsa_number')->nullable()->after('name_of_farmer');
            $table->string('ear_tag_number')->nullable()->after('animal_type');
            $table->boolean('moa_signed')->nullable()->after('ear_tag_number');
        });
    }

    public function down(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->dropColumn(['rsbsa_number', 'ear_tag_number', 'moa_signed']);
        });
    }
};
