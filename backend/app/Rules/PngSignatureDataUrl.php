<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A canvas-captured signature, arriving as a PNG data URL.
 *
 * Signatures are audit evidence, so the rule is deliberately narrow: only a
 * real PNG may be stored (no JPEG/SVG/PDF smuggling), the decoded bytes must
 * carry the PNG magic number, and the image is capped well below the generic
 * upload limit — a signature is a few KB of strokes, not a photograph.
 */
class PngSignatureDataUrl implements ValidationRule
{
    /** The exact prefix a canvas `toDataURL("image/png")` produces. */
    public const PREFIX = 'data:image/png;base64,';

    /** Decoded-bytes ceiling: 2 MB is already far more than any signature. */
    public const MAX_BYTES = 2_000_000;

    /**
     * Decode a validated data URL to its PNG bytes, or null when malformed.
     * Callers that have already validated with this rule still guard: a
     * service can be reached from a future caller that skipped the request.
     */
    public static function decode(string $dataUrl): ?string
    {
        if (! str_starts_with($dataUrl, self::PREFIX)) {
            return null;
        }

        $binary = base64_decode(substr($dataUrl, strlen(self::PREFIX)), true);

        if ($binary === false || strncmp($binary, "\x89PNG\r\n\x1a\n", 8) !== 0) {
            return null;
        }

        return $binary;
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! str_starts_with($value, self::PREFIX)) {
            $fail('The signature must be a PNG captured from the signature pad.');

            return;
        }

        $binary = self::decode($value);

        if ($binary === null) {
            $fail('The signature image could not be read. Please sign again.');

            return;
        }

        if (strlen($binary) > self::MAX_BYTES) {
            $fail('The signature image is too large. Please sign again.');
        }
    }
}
