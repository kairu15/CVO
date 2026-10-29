<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/admin/barangays/{barangay} — re-center a coverage area, or
 * record its population.
 *
 * Deliberately NO `name` rule: a barangay rename orphans every historical
 * free-text beneficiary address that normalizes against the old spelling
 * (App\Support\Barangays::normalize). The name is immutable; coordinates and
 * population are data and move freely.
 */
class AdminBarangayUpdateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('manage_reference_data');
    }

    protected function failedAuthorization(): never
    {
        abort(403, 'You do not have permission to perform this action.');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'latitude' => ['sometimes', 'numeric', 'between:-90,90'],
            'longitude' => ['sometimes', 'numeric', 'between:-180,180'],
            // Optional per-barangay population behind the analytics "per 1,000
            // residents" view. Nullable: blanking it removes the figure — the
            // system never prefills or invents one.
            'population' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:10000000'],
        ];
    }
}
