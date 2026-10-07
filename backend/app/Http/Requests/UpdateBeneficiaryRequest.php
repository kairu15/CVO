<?php

namespace App\Http\Requests;

use App\Support\Barangays;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/beneficiaries/{id} — update a beneficiary (item 5).
 *
 * The technician_id rule differs by role: only an administrator may hand a
 * household to a technician, and only to an account that actually holds the
 * technician role. Everyone else gets a `prohibited` rule so a hand-crafted
 * payload cannot smuggle an assignment past the role check.
 */
class UpdateBeneficiaryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name_of_farmer' => ['sometimes', 'string', 'max:255'],
            'address' => [
                'sometimes',
                'string',
                'max:255',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! Barangays::isCovered((string) $value)) {
                        $fail('Choose a barangay covered by the program: '.implode(', ', Barangays::all()).'.');
                    }
                },
            ],
            'animal_type' => ['sometimes', 'string', 'max:255'],
            'sex' => ['sometimes', 'in:M,F'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'technician_id' => $this->user()?->hasPermission('assign_technicians')
                ? ['nullable', 'integer', 'exists:users,id,role,technician']
                : ['prohibited'],
        ];
    }
}
