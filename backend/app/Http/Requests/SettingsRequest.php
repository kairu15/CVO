<?php

namespace App\Http\Requests;

use App\Services\SettingsService;
use Illuminate\Foundation\Http\FormRequest;

class SettingsRequest extends FormRequest
{
    /**
     * Settings changes are admin-only. Like ReportRequest this rides under
     * EnsureUserIsAdmin at the route too — the FormRequest is the second gate,
     * not the only one.
     */
    public function authorize(): bool
    {
        return $this->user()->hasPermission('manage_settings');
    }

    public function rules(): array
    {
        return [
            // Reference data has its own dedicated admin endpoints
            // (POST/PATCH /admin/barangays, /admin/puroks). A payload that
            // carries the whole list here is rejected rather than quietly
            // ignored — a silent drop would hide the client bug instead of
            // naming it.
            'barangays' => ['prohibited'],

            // Office contact details, shown on the public landing page and the
            // in-app Support page.
            'office_email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'office_phone' => ['sometimes', 'nullable', 'string', 'max:255'],
            'office_hours' => ['sometimes', 'nullable', 'string', 'max:255'],
            'office_address' => ['sometimes', 'nullable', 'string', 'max:255'],

            // Vaccination cycle + field-visit window (Alerts & Thresholds).
            // These reach every derived surface that uses them — the
            // Vaccination Schedule, the animal-health rollup, the public
            // counts and the smart-alert scan — so the bounds are wide but
            // finite: a year-scale interval is legitimate, a nonsense one
            // (or a zero/negative) is not.
            'vaccination_interval_days' => ['sometimes', 'integer', 'min:1', 'max:3650'],
            'vaccination_due_soon_days' => ['sometimes', 'integer', 'min:1', 'max:365'],
            'field_visit_overdue_days' => ['sometimes', 'integer', 'min:1', 'max:3650'],

            // The suggested animal-type vocabulary. A suggestion, not a
            // filter: the importer keeps unknown workbook values as their own
            // type, so this list can never invalidate existing records. Saved
            // wholesale (the UI edits the list, not individual slots).
            'animal_types' => ['sometimes', 'array', 'max:40'],
            'animal_types.*' => ['required', 'string', 'min:1', 'max:50', 'distinct'],

            // Notification preferences: one switch per stored event type and
            // per smart-alert rule, keyed notify_*. Anything else in the
            // payload is already ignored by SettingsService::save.
            ...collect(SettingsService::NOTIFICATION_KEYS)
                ->mapWithKeys(fn (string $key) => [$key => ['sometimes', 'boolean']])
                ->all(),

            // The SPA's inactivity auto-logout window. Capped at the SERVER's
            // own idle window: a longer client window would mean the user is
            // silently 401'd mid-form with no warning, which is the exact
            // failure this guard exists to prevent.
            'session_idle_minutes' => [
                'sometimes',
                'integer',
                'min:1',
                'max:'.(int) config('security.session_idle'),
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'barangays.prohibited' => 'The barangay list is fixed by the program and cannot be changed here.',
            'session_idle_minutes.max' => 'The inactivity timeout cannot exceed the server\'s own session limit of :max minutes.',
        ];
    }
}
