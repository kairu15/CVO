<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/admin/barangays/{barangay}/puroks — record a real purok/sitio,
 * typically replacing a seeded placeholder. Puroks are FK-referenced by
 * beneficiaries.purok_id, so adding (and renaming) them is safe; only the
 *barangay's own name normalization makes renames dangerous at the barangay
 * level.
 */
class AdminPurokStoreRequest extends FormRequest
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
        $barangayId = $this->route('barangay')?->id;

        return [
            'name' => [
                'required',
                'string',
                'min:1',
                'max:255',
                Rule::unique('puroks', 'name')->where('barangay_id', $barangayId),
            ],
            // Optional on purpose: the seeded placeholders carry no centers,
            // and a purok without one still works in the cascade — only the
            // GPS auto-detect needs coordinates.
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.unique' => 'This barangay already has a purok with this name.',
        ];
    }
}
