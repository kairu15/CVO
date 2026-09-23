<?php

namespace App\Http\Requests;

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
        return $this->user()->role === 'admin';
    }

    public function rules(): array
    {
        return [
            // The registration form's dropdown, served read-only (see
            // SettingsController). Renaming a barangay would orphan every
            // beneficiary address normalized against it, so a payload that
            // even carries the key is rejected rather than quietly ignored —
            // a silent drop would hide the client bug instead of naming it.
            'barangays' => ['prohibited'],

            // Office contact details, shown on the public landing page and the
            // in-app Support page.
            'office_email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'office_phone' => ['sometimes', 'nullable', 'string', 'max:255'],
            'office_hours' => ['sometimes', 'nullable', 'string', 'max:255'],
            'office_address' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }

    public function messages(): array
    {
        return [
            'barangays.prohibited' => 'The barangay list is fixed by the program and cannot be changed here.',
        ];
    }
}
