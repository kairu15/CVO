<?php

namespace App\Support;

use App\Models\Barangay;
use Illuminate\Support\Facades\Config;

/**
 * Barangay helpers over the authoritative coverage data.
 *
 * The official list lives in config/barangays.php (28 entries with centers)
 * and is seeded into the database `barangays` table. Read paths prefer the
 * table (it carries ids for the FK relations) and fall back to the config
 * file when the database is unreachable or not yet seeded — so registration
 * validation and geocoding fallback keep working even mid-migration.
 *
 * `BarangayCenters` was kept as an alias so the coordinate map that used to
 * live in BeneficiaryFactory::BARANGAY_COORDS still resolves.
 */
class Barangays
{
    /**
     * The covered barangays, display order. Names only — the dropdown source.
     *
     * @return list<string>
     */
    public static function all(): array
    {
        $fromDb = self::namesFromDb();

        return $fromDb ?? array_map(
            fn (array $entry) => $entry['name'],
            Config::array('barangays.entries', []),
        );
    }

    /**
     * Name → [lat, lng] for every covered barangay. Cache-backed at runtime;
     * seeded DB first, config fallback second.
     *
     * @return array<string, array{0: float, 1: float}>
     */
    public static function centers(): array
    {
        static $cached = null;

        if ($cached !== null) {
            return $cached;
        }

        $fromDb = self::namesFromDb(centersToo: true);

        if (is_array($fromDb)) {
            return $cached = $fromDb;
        }

        return $cached = collect(Config::array('barangays.entries', []))
            ->mapWithKeys(fn (array $entry) => [
                $entry['name'] => [(float) $entry['latitude'], (float) $entry['longitude']],
            ])
            ->all();
    }

    /**
     * Center coordinates for one barangay name, or null when not covered.
     *
     * @return array{0: float, 1: float}|null
     */
    public static function centerFor(string $name): ?array
    {
        return self::centers()[$name] ?? null;
    }

    /**
     * True when the given address names a covered barangay (either spelling).
     */
    public static function isCovered(string $address): bool
    {
        return self::indexOf(self::normalize($address)) !== null;
    }

    /**
     * Match an address against the list ignoring case and inner spaces, so
     * "Banaybanay" and "banay banay" both hit "Banaybanay". Returns the
     * input unchanged when it names no covered barangay.
     */
    public static function normalize(string $address): string
    {
        $folded = str_replace(' ', '', mb_strtolower(trim($address)));

        foreach (self::all() as $barangay) {
            if ($folded === str_replace(' ', '', mb_strtolower($barangay))) {
                return $barangay;
            }
        }

        return trim($address);
    }

    /**
     * The barangay_id for a (normalized) barangay name, or null. Database
     * only — callers must not depend on this resolving during tests that
     * skipped the location seeder.
     */
    public static function idFor(string $name): ?int
    {
        return Barangay::query()->where('name', $name)->value('id');
    }

    /**
     * Names from the database table, or null when the table is unavailable
     * or empty (config fallback then applies). Optionally keyed centers.
     */
    protected static function namesFromDb(bool $centersToo = false): ?array
    {
        try {
            $rows = Barangay::query()->orderBy('id')->get(['name', 'latitude', 'longitude']);
        } catch (\Throwable) {
            return null; // table not migrated yet — config fallback
        }

        if ($rows->isEmpty()) {
            return null;
        }

        return $centersToo
            ? $rows->mapWithKeys(fn (Barangay $b) => [$b->name => [(float) $b->latitude, (float) $b->longitude]])->all()
            : $rows->pluck('name')->all();
    }

    /**
     * Index of the (normalized) name in the coverage list, or null.
     */
    protected static function indexOf(string $name): ?int
    {
        $found = array_search($name, self::all(), true);

        return $found === false ? null : $found;
    }
}
