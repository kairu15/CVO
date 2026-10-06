<?php

namespace App\Services;

use App\Models\Setting;
use Illuminate\Support\Facades\Cache;

/**
 * System settings — the values an administrator can change without a deploy.
 *
 * Three groups, one table, one cache entry:
 *
 *   contact  the office contact profile. Rendered on the public landing page,
 *            the farmer Support page and the password-reset note, so it is
 *            read on nearly every anonymous request.
 *   alerts   the vaccination cycle (how long after a vaccination an animal is
 *            due again, and how far ahead it warns). These used to be
 *            config-only, which made a clinical decision a code deploy.
 *   session  the SPA's own inactivity auto-logout window.
 *
 * Defaults live in config (config/cvo.php, config/security.php) and a key that
 * has never been saved falls back to them, so the table starts empty and every
 * value has one obvious meaning instead of two. Writes forget the cache, so a
 * stale number can outlive an edit by exactly zero requests.
 *
 * Deliberately NOT here: the barangay/purok reference data. Beneficiary
 * addresses and every validation rule normalize against that list, so renaming
 * a barangay would silently orphan every historical row that spells it the old
 * way. It stays configuration (see SettingsController).
 */
class SettingsService
{
    /** @var list<string> */
    public const CONTACT_KEYS = ['office_email', 'office_phone', 'office_hours', 'office_address'];

    /** @var list<string> */
    public const ALERT_KEYS = ['vaccination_interval_days', 'vaccination_due_soon_days'];

    /** @var list<string> */
    public const SESSION_KEYS = ['session_idle_minutes'];

    /**
     * Every key this service owns. Anything else in the table is ignored.
     *
     * @var list<string>
     */
    public const KEYS = [
        ...self::CONTACT_KEYS,
        ...self::ALERT_KEYS,
        ...self::SESSION_KEYS,
    ];

    private const CACHE_KEY = 'settings.values';

    /**
     * All groups, typed — what the System Settings screen renders.
     *
     * @return array{contact: array<string, string|null>, alerts: array<string, int>, session: array{idle_minutes: int}}
     */
    public function all(): array
    {
        $values = $this->values();

        return [
            'contact' => [
                'office_email' => $values['office_email'],
                'office_phone' => $values['office_phone'],
                'office_hours' => $values['office_hours'],
                'office_address' => $values['office_address'],
            ],
            'alerts' => [
                'vaccination_interval_days' => (int) $values['vaccination_interval_days'],
                'vaccination_due_soon_days' => (int) $values['vaccination_due_soon_days'],
            ],
            'session' => [
                'idle_minutes' => (int) $values['session_idle_minutes'],
            ],
        ];
    }

    /**
     * The office contact profile.
     *
     * @return array<string, string|null>
     */
    public function officeProfile(): array
    {
        return $this->all()['contact'];
    }

    /**
     * The vaccination cycle thresholds.
     *
     * @return array<string, int>
     */
    public function alerts(): array
    {
        return $this->all()['alerts'];
    }

    /**
     * How long after a vaccination an animal becomes due again.
     */
    public function vaccinationIntervalDays(): int
    {
        return $this->all()['alerts']['vaccination_interval_days'];
    }

    /**
     * How far ahead of the due date an animal starts warning.
     */
    public function vaccinationDueSoonDays(): int
    {
        return $this->all()['alerts']['vaccination_due_soon_days'];
    }

    /**
     * The SPA's inactivity auto-logout window, in minutes.
     *
     * This is the CLIENT guard (IdleSessionGuard), deliberately shorter than
     * the server's own session lifetime so a user is warned and signed out
     * before the server would 401 them mid-form. The server's own windows are
     * not writable from the UI — they are enforced by the framework's session
     * configuration and cannot change without a restart, so the settings
     * screen shows them read-only rather than pretending to own them.
     */
    public function sessionIdleMinutes(): int
    {
        return $this->all()['session']['idle_minutes'];
    }

    /**
     * Save any subset of the keys this service owns and drop the read cache.
     *
     * @param  array<string, string|int|null>  $values  Validated key => value pairs.
     */
    public function save(array $values): void
    {
        foreach (self::KEYS as $key) {
            if (! array_key_exists($key, $values)) {
                continue;
            }

            Setting::updateOrCreate(
                ['key' => $key],
                ['value' => $values[$key] === null ? null : (string) $values[$key]],
            );
        }

        Cache::forget(self::CACHE_KEY);
    }

    /**
     * Save the office contact profile and return it.
     *
     * @param  array<string, string|null>  $values
     * @return array<string, string|null>
     */
    public function saveOfficeProfile(array $values): array
    {
        $this->save($values);

        return $this->officeProfile();
    }

    /**
     * Every owned key, saved value or config default.
     *
     * @return array<string, string|null>
     */
    private function values(): array
    {
        $rows = Cache::remember(
            self::CACHE_KEY,
            now()->addHours(12),
            fn () => Setting::query()->whereIn('key', self::KEYS)->pluck('value', 'key')->all(),
        );

        // Saved rows win over defaults. A key that was never saved has no row
        // at all, so it keeps its default; a saved NULL is a row whose value
        // is null, so it stays cleared rather than reverting to the shipped
        // placeholder — an administrator has to be able to blank a phone
        // number the office no longer uses.
        return array_merge($this->defaults(), $rows);
    }

    /**
     * The shipped defaults: the deploy-time values in config. A setting that
     * was never saved falls back here so the UI never shows an empty phone
     * number that is actually "unset".
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

            'vaccination_interval_days' => (string) config('cvo.vaccination_interval_days'),
            'vaccination_due_soon_days' => (string) config('cvo.vaccination_due_soon_days'),

            'session_idle_minutes' => (string) config('security.client_idle_minutes'),
        ];
    }
}
