<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH /api/v1/admin/puroks/{purok} — rename or re-center a purok. Renaming
 * is safe: beneficiaries point at the purok by id, so history follows the
 * row instead of the spelling.
 */
class AdminPurokUpdateRequest extends FormRequest
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
        $purok = $this->route('purok');

        return [
            'name' => [
                'sometimes',
                'string',
                'min:1',
                'max:255',
                Rule::unique('puroks', 'name')
                    ->where('barangay_id', $purok?->barangay_id)
                    ->ignore($purok?->id),
            ],
            'latitude' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'is_placeholder' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.unique' => 'This barangay already has a purok with this name.',
        ];
    }
}
