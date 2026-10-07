<?php

namespace App\Services;

use App\Models\Setting;
use Illuminate\Support\Facades\Cache;

/**
 * System settings — the values an administrator can change without a deploy.
 *
 * Five groups, one table, one cache entry:
 *
 *   contact       the office contact profile. Rendered on the public landing
 *                 page, the farmer Support page and the password-reset note,
 *                 so it is read on nearly every anonymous request.
 *   alerts        the vaccination cycle (how long after a vaccination an
 *                 animal is due again, how far ahead it warns) and the
 *                 field-visit overdue window the smart-alert scan uses.
 *                 These used to be config-only, which made a clinical
 *                 decision a code deploy.
 *   session       the SPA's own inactivity auto-logout window.
 *   animal_types  the suggested species vocabulary forms offer. Still a
 *                 suggestion — the importer keeps unknown workbook values as
 *                 their own type — but the list itself is now data, so a new
 *                 program category does not need a deploy.
 *   notifications which stored event types and smart-alert rules actually
 *                 write notification rows. A disabled type is suppressed at
 *                 write time; for smart alerts the next scan also clears the
 *                 rows the disabled rule had already written.
 *
 * Defaults live in config (config/cvo.php, config/security.php) and a key that
 * has never been saved falls back to them, so the table starts empty and every
 * value has one obvious meaning instead of two. Writes forget the cache, so a
 * stale number can outlive an edit by exactly zero requests.
 *
 * Deliberately NOT here: renaming barangays. Beneficiary addresses and every
 * validation rule normalize against that list, so renaming a barangay would
 * silently orphan every historical row that spells it the old way. Puroks are
 * FK-referenced (beneficiaries.purok_id), so purok add/rename IS safe and is
 * managed through the dedicated reference-data endpoints — see
 * BarangayController, not this service.
 */
class SettingsService
{
    /** @var list<string> */
    public const CONTACT_KEYS = ['office_email', 'office_phone', 'office_hours', 'office_address'];

    /** @var list<string> */
    public const ALERT_KEYS = [
        'vaccination_interval_days',
        'vaccination_due_soon_days',
        'field_visit_overdue_days',
    ];

    /** @var list<string> */
    public const SESSION_KEYS = ['session_idle_minutes'];

    /** The suggested animal-type vocabulary, stored as a JSON list. */
    public const ANIMAL_TYPES_KEY = 'animal_types';

    /**
     * Which notification types actually write rows. Every stored event type
     * and every smart-alert rule gets a `notify_*` switch, defaulting to on:
     * the seeded behaviour is today's behaviour.
     *
     * @var list<string>
     */
    public const NOTIFICATION_KEYS = [
        'notify_registration_new',
        'notify_registration_accepted',
        'notify_technician_assigned',
        'notify_technician_reassigned',
        'notify_field_visit_photo',
        'notify_smart_vaccination_overdue',
        'notify_smart_bcs_out_of_range',
        'notify_smart_no_recent_visit',
        'notify_smart_barangay_flag',
    ];

    /**
     * Notification type → its notify_* settings key. Types absent from this
     * map (the derived feed: dispersal, re-dispersal, vaccination due/overdue)
     * restate existing records on read and are not written anywhere, so there
     * is nothing to switch off.
     *
     * @var array<string, string>
     */
    public const NOTIFICATION_KEY_FOR_TYPE = [
        'registration-new' => 'notify_registration_new',
        'registration-accepted' => 'notify_registration_accepted',
        'technician-assigned' => 'notify_technician_assigned',
        'technician-reassigned' => 'notify_technician_reassigned',
        'field-visit-photo' => 'notify_field_visit_photo',
        'smart-vaccination-overdue' => 'notify_smart_vaccination_overdue',
        'smart-bcs-out-of-range' => 'notify_smart_bcs_out_of_range',
        'smart-no-recent-visit' => 'notify_smart_no_recent_visit',
        'smart-barangay-flag' => 'notify_smart_barangay_flag',
    ];

    /**
     * Every key this service owns. Anything else in the table is ignored.
     *
     * @var list<string>
     */
    public const KEYS = [
        ...self::CONTACT_KEYS,
        ...self::ALERT_KEYS,
        ...self::SESSION_KEYS,
        self::ANIMAL_TYPES_KEY,
        ...self::NOTIFICATION_KEYS,
    ];

    private const CACHE_KEY = 'settings.values';

    /**
     * All groups, typed — what the System Settings screen renders.
     *
     * @return array{contact: array<string, string|null>, alerts: array<string, int>, session: array{idle_minutes: int}, animal_types: list<string>, notifications: array<string, bool>}
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
                'field_visit_overdue_days' => (int) $values['field_visit_overdue_days'],
            ],
            'session' => [
                'idle_minutes' => (int) $values['session_idle_minutes'],
            ],
            'animal_types' => $this->animalTypes(),
            'notifications' => $this->notifications(),
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
     * How stale a household's latest field visit may get before the smart
     * alert scan flags it (and how old a household may be before the rule
     * applies at all).
     */
    public function fieldVisitOverdueDays(): int
    {
        return $this->all()['alerts']['field_visit_overdue_days'];
    }

    /**
     * The suggested animal-type vocabulary — the list the forms offer and the
     * importer uses for casing. Falls back to config when the key was never
     * saved; an admin-saved list replaces it wholesale.
     *
     * @return list<string>
     */
    public function animalTypes(): array
    {
        $decoded = json_decode((string) ($this->values()[self::ANIMAL_TYPES_KEY] ?? ''), true);

        if (! is_array($decoded)) {
            return array_values(config('cvo.animal_types', []));
        }

        return array_values(array_filter($decoded, fn ($t) => is_string($t) && trim($t) !== ''));
    }

    /**
     * Replace the suggested animal-type vocabulary.
     *
     * @param  list<string>  $types
     */
    public function saveAnimalTypes(array $types): void
    {
        $clean = array_values(array_unique(array_map(
            fn (string $t) => trim($t),
            array_filter($types, fn ($t) => is_string($t) && trim($t) !== ''),
        )));

        Setting::updateOrCreate(
            ['key' => self::ANIMAL_TYPES_KEY],
            ['value' => json_encode($clean)],
        );

        Cache::forget(self::CACHE_KEY);
    }

    /**
     * Every toggleable notification type with its on/off state.
     *
     * @return array<string, bool>
     */
    public function notifications(): array
    {
        $values = $this->values();

        return collect(self::NOTIFICATION_KEY_FOR_TYPE)
            ->mapWithKeys(fn (string $key, string $type) => [
                $type => (bool) $values[$key],
            ])
            ->all();
    }

    /**
     * Whether a notification type currently writes rows. Unknown types
     * (e.g. the derived feed, which writes nothing) default to enabled so a
     * caller cannot silently lose a notification by typo'ing the key.
     */
    public function notificationTypeEnabled(string $type): bool
    {
        $key = self::NOTIFICATION_KEY_FOR_TYPE[$type] ?? null;

        if ($key === null) {
            return true;
        }

        return (bool) $this->values()[$key];
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

            // Booleans store as '1'/'0' — PHP's bare (string) cast turns
            // false into '', which reads back falsy by luck rather than by
            // intent. One storage convention for every on/off key.
            $value = is_bool($values[$key]) ? ($values[$key] ? '1' : '0') : $values[$key];

            Setting::updateOrCreate(
                ['key' => $key],
                ['value' => $value === null ? null : (string) $value],
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
            'field_visit_overdue_days' => (string) config('cvo.smart_alerts.no_recent_visit_days'),

            'session_idle_minutes' => (string) config('security.client_idle_minutes'),

            self::ANIMAL_TYPES_KEY => json_encode(array_values(config('cvo.animal_types', []))),

            // Notification switches default to on: the seeded behaviour is
            // exactly today's behaviour, and an admin can only turn things
            // off, never have to discover the list to turn things on.
            ...array_fill_keys(self::NOTIFICATION_KEYS, '1'),
        ];
    }
}
