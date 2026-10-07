<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/admin/barangays/{barangay} — re-center a coverage area.
 *
 * Deliberately NO `name` rule: a barangay rename orphans every historical
 * free-text beneficiary address that normalizes against the old spelling
 * (App\Support\Barangays::normalize). The name is immutable; coordinates are
 * data and move freely.
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
        ];
    }
}
