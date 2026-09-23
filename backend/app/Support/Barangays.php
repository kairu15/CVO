<?php

namespace App\Support;

use Illuminate\Support\Facades\Config;

/**
 * Barangay helpers over the authoritative list in config/cvo.php.
 *
 * The registration form dropdown, validation and geocoding fallback all
 * resolve names through here, so "Banaybanay" and "Banay Banay" are the
 * same barangay everywhere.
 */
class Barangays
{
    /**
     * The covered barangays, display order.
     *
     * @return list<string>
     */
    public static function all(): array
    {
        return Config::array('cvo.barangays', []);
    }

    /**
     * True when the given address names a covered barangay (either spelling).
     */
    public static function isCovered(string $address): bool
    {
        $normalized = self::normalize($address);

        return in_array($normalized, self::all(), true);
    }

    /**
     * Match an address against the list ignoring case and inner spaces, so
     * "Banaybanay" and "banay banay" both hit "Banay Banay". Returns the
     * input unchanged when it names no covered barangay.
     */
    public static function normalize(string $address): string
    {
        $folded = mb_strtolower(trim($address));

        foreach (self::all() as $barangay) {
            if (str_replace(' ', '', $folded) === str_replace(' ', '', mb_strtolower($barangay))) {
                return $barangay;
            }
        }

        return trim($address);
    }
}
