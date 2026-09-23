<?php

namespace App\Services;

use App\Models\Setting;
use Illuminate\Support\Facades\Cache;

/**
 * System settings — the office contact profile, and nothing more (see the
 * settings migration for why the barangay list is deliberately absent).
 *
 * Reads are cached: the contact details render on the public landing page and
 * the Support page, so they are read on nearly every request, while writes
 * happen roughly never. The cache is forgotten on save, so a stale number can
 * outlive an edit by exactly zero requests.
 */
class SettingsService
{
    /** The keys this service owns. Anything else in the table is ignored. */
    public const KEYS = ['office_email', 'office_phone', 'office_hours', 'office_address'];

    private const CACHE_KEY = 'settings.office_profile';

    /**
     * The office contact profile, with defaults from config/site-style
     * placeholders when a key has never been saved.
     *
     * @return array<string, string|null>
     */
    public function officeProfile(): array
    {
        $rows = Cache::remember(self::CACHE_KEY, now()->addHours(12), fn () => $this->readRows());

        return array_merge($this->defaults(), $rows);
    }

    /**
     * Save the office contact profile and drop the read cache.
     *
     * @param  array<string, string|null>  $values  Validated key => value pairs.
     */
    public function saveOfficeProfile(array $values): array
    {
        foreach (self::KEYS as $key) {
            if (! array_key_exists($key, $values)) {
                continue;
            }

            Setting::updateOrCreate(
                ['key' => $key],
                ['value' => $values[$key]],
            );
        }

        Cache::forget(self::CACHE_KEY);

        return $this->officeProfile();
    }

    /**
     * @return array<string, string|null>
     */
    private function readRows(): array
    {
        return Setting::query()
            ->whereIn('key', self::KEYS)
            ->pluck('value', 'key')
            ->all();
    }

    /**
     * The shipped placeholder values — what the SPA's site.js hard-codes
     * today. A setting that was never saved falls back here so the UI never
     * shows an empty phone number that is actually "unset".
     *
     * @return array<string, string|null>
     */
    private function defaults(): array
    {
        return [
            'office_email' => config('cvo.office.email'),
            'office_phone' => config('cvo.office.phone'),
            'office_hours' => config('cvo.office.hours'),
            'office_address' => config('cvo.office.address'),
        ];
    }
}
