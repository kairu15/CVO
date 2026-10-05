<?php

namespace App\Support;

/**
 * Normalization for the free-text "Type of Animal dispersed" column.
 *
 * The animal types are taken FROM THE IMPORTED WORKBOOK — there is no fixed
 * vocabulary that renames a species the CVO's sheet carries. This class only
 * removes the accidental differences that would otherwise split one type into
 * several groups:
 *
 *   - surrounding and repeated whitespace ("cattle  " → "Cattle")
 *   - casing ("CATTLE" → "Cattle", "cattle" → "Cattle")
 *
 * A value that matches the suggested vocabulary in config/cvo.php takes that
 * vocabulary's exact casing; every other value is kept as its own type
 * (title-cased). A blank cell becomes "Unspecified".
 *
 * So a workbook containing "Carabao", "Chicken" and "Bore" yields exactly
 * those three filter options — nothing is merged into "Poultry"/"Boar" and
 * nothing is discarded.
 */
class AnimalTypes
{
    /** Used for a blank cell. */
    public const UNSPECIFIED = 'Unspecified';

    /**
     * The suggested vocabulary (config/cvo.php → animal_types), used ONLY to
     * give a known value its preferred casing. It never replaces or rejects a
     * value that is absent from the list.
     *
     * @return list<string>
     */
    public static function suggested(): array
    {
        return array_values(config('cvo.animal_types', []));
    }

    /**
     * Fold a free-text value into its canonical display form.
     *
     * Trim + collapse internal whitespace, then match (case-insensitively)
     * against the suggested vocabulary for casing. A blank value becomes
     * "Unspecified"; anything else is kept, title-cased.
     */
    public static function normalize(mixed $value): string
    {
        if ($value === null) {
            return self::UNSPECIFIED;
        }

        // Numbers (stray Excel serials etc.) are not animal types.
        $raw = is_scalar($value) ? trim((string) $value) : '';

        if ($raw === '') {
            return self::UNSPECIFIED;
        }

        $raw = (string) preg_replace('/\s+/', ' ', $raw);
        $key = mb_strtolower($raw);

        // A known type keeps the vocabulary's exact casing.
        foreach (self::suggested() as $type) {
            if (mb_strtolower($type) === $key) {
                return $type;
            }
        }

        // Everything else is its own type, title-cased so the same value from
        // another row is not split by inconsistent capitalization.
        return mb_convert_case($raw, MB_CASE_TITLE);
    }
}
