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

            // Field-visit verification radius (Feature 1). A policy number
            // the office picks — wide enough to absorb ordinary GPS noise,
            // never so wide that "on site" stops meaning anything.
            'onsite_threshold_m' => ['sometimes', 'integer', 'min:1', 'max:10000'],

            // How far back a dispersal/re-dispersal may be dated. Zero means
            // "today only"; the ceiling keeps a mistyped year from backfilling
            // the whole programme in one field visit.
            'dispersal_max_backdate_days' => ['sometimes', 'integer', 'min:0', 'max:3650'],

            // The route planner's fallback start (the CVO office pin).
            'office_latitude' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'office_longitude' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],

            // Cluster scan inputs (Feature 3) — N days, K cases, R kilometres.
            'cluster_lookback_days' => ['sometimes', 'integer', 'min:1', 'max:365'],
            'cluster_min_cases' => ['sometimes', 'integer', 'min:2', 'max:100'],
            'cluster_radius_km' => ['sometimes', 'numeric', 'min:0.1', 'max:50'],

            // Which clinical outcomes count as a case. Saved wholesale like
            // the other vocabularies; the scan intersects it with the live
            // outcome list at read time.
            'cluster_reportable_outcomes' => ['sometimes', 'array', 'max:20'],
            'cluster_reportable_outcomes.*' => ['required', 'string', 'min:1', 'max:50', 'distinct'],

            // The suggested animal-type vocabulary. A suggestion, not a
            // filter: the importer keeps unknown workbook values as their own
            // type, so this list can never invalidate existing records. Saved
            // wholesale (the UI edits the list, not individual slots).
            'animal_types' => ['sometimes', 'array', 'max:40'],
            'animal_types.*' => ['required', 'string', 'min:1', 'max:50', 'distinct'],

            // The clinical outcome and field-visit purpose vocabularies. Same
            // "the list is data" pattern as the animal types: saved wholesale,
            // values distinct within the list. The API's own validation and
            // the forms' dropdowns both read them back through SettingsService,
            // so an edit here is the single source of truth.
            'health_outcomes' => ['sometimes', 'array', 'max:20'],
            'health_outcomes.*' => ['required', 'string', 'min:1', 'max:50', 'distinct'],
            'field_visit_purposes' => ['sometimes', 'array', 'max:20'],
            'field_visit_purposes.*' => ['required', 'string', 'min:1', 'max:50', 'distinct'],

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
