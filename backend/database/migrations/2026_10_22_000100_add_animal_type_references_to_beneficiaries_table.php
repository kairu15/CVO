<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Point each animal record (a beneficiary row) at the master list.
     *
     * `animal_type_id` is nullable because historical rows may carry a value
     * that cannot be mapped safely — a typo, a category ("Poultry"), or a term
     * shared by several species ("Boar" exists under Swine AND Guinea pig).
     * Those rows are deliberately LEFT unmapped rather than guessed: dropping
     * the value would lose the office's data, and assigning the first match
     * would silently misclassify an animal. `php artisan
     * animal-types:mapping-report` lists them for manual correction, and
     * `--apply` writes the ones the migration could not settle.
     *
     * `classification_id` is nullable for every historical row: the old sheets
     * recorded a coarse type, rarely a sex/age class. It is only ever filled
     * when the imported value is unambiguous.
     *
     * The legacy `animal_type` string column is intentionally NOT dropped. It
     * is kept as the display/sync column (free-text imports and older API
     * clients still write it), and the FK is the structured truth the filters
     * and reports use. Dropping it would break historical rows the mapping
     * could not resolve; it can be retired once the mapping report is clean.
     */
    public function up(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->foreignId('animal_type_id')
                ->nullable()
                ->after('animal_type')
                ->constrained('animal_types')
                ->nullOnDelete();

            $table->foreignId('classification_id')
                ->nullable()
                ->after('animal_type_id')
                ->constrained('animal_classifications')
                ->nullOnDelete();

            $table->index(['animal_type_id', 'classification_id']);
        });

        $this->mapExistingTypes();
    }

    public function down(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->dropIndex(['animal_type_id', 'classification_id']);
            $table->dropConstrainedForeignId('classification_id');
            $table->dropConstrainedForeignId('animal_type_id');
        });
    }

    /**
     * Map only the values with exactly ONE plausible type.
     *
     * The two match rules mirror the catalogue service:
     *   1. the value IS the type name ("Cattle"), or
     *   2. the value is the type's short form before a parenthetical
     *      ("Swine" → "Swine (Pig)", "Carabao" → "Carabao (Water Buffalo)").
     *
     * A value matching several types, or none at all, is left for the report.
     * No classification is assigned here: the old column never distinguished
     * a classification from a type, so guessing one would invent data.
     */
    private function mapExistingTypes(): void
    {
        $types = DB::table('animal_types')->get(['id', 'name']);

        if ($types->isEmpty()) {
            return;
        }

        $legacyValues = DB::table('beneficiaries')
            ->select('animal_type')
            ->whereNotNull('animal_type')
            ->where('animal_type', '!=', '')
            ->distinct()
            ->pluck('animal_type');

        foreach ($legacyValues as $legacy) {
            $normalized = mb_strtolower((string) preg_replace('/\s+/', ' ', trim((string) $legacy)));

            $matches = $types->filter(function (object $type) use ($normalized): bool {
                $name = mb_strtolower($type->name);

                return $name === $normalized
                    || str_starts_with($name, $normalized.' (');
            });

            if ($matches->count() !== 1) {
                continue; // ambiguous or unknown — reported, never guessed
            }

            DB::table('beneficiaries')
                ->whereRaw('LOWER(TRIM(animal_type)) = ?', [$normalized])
                ->update(['animal_type_id' => $matches->first()->id]);
        }
    }
};
