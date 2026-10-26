<?php

namespace App\Support;

/**
 * Masking for identifiers the Data Privacy Act treats as personal data.
 *
 * One implementation, used by every surface that would otherwise show the raw
 * value — the audit trail stores this masked shape (so the log never becomes
 * the copy that leaks), and section 3's API resources reuse the same function
 * so the UI and the audit rows can never disagree.
 *
 * Deliberately NOT a claim of legal compliance: masking one column is a
 * technical control, not a compliance programme. Copy stays factual.
 */
class SensitiveMask
{
    /**
     * Model attributes whose values are masked before they are written to the
     * audit trail. Sections that need more (section 3's `view_sensitive_ids`
     * reveal) extend this list rather than adding ad-hoc masking calls.
     *
     * @var list<string>
     */
    public const MASKED_FIELDS = [
        'rsbsa_number',
    ];

    /** Shorter values are hidden whole — see id(). */
    private const TAIL_VISIBLE_FROM = 12;

    /**
     * `12345678901234` → `••••-••••-1234`: only the last four characters
     * survive, in the grouped shape the privacy controls show everywhere else.
     *
     * Short values are masked WHOLE: with fewer than twelve characters the
     * tail would give away most of the value, which is not a mask at all.
     */
    public static function id(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return $value;
        }

        if (mb_strlen($value) < self::TAIL_VISIBLE_FROM) {
            return str_repeat('•', mb_strlen($value));
        }

        return '••••-••••-'.mb_substr($value, -4);
    }

    /**
     * Apply MASKED_FIELDS to a payload destined for storage (audit rows,
     * exports). The input is never modified in place.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    public static function apply(array $values): array
    {
        foreach (self::MASKED_FIELDS as $field) {
            if (array_key_exists($field, $values) && is_string($values[$field])) {
                $values[$field] = self::id($values[$field]);
            }
        }

        return $values;
    }
}
