<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Adopt a visit's captured fix as a beneficiary's registered pin.
 *
 * Second gate behind the route's capability check (beneficiaries.update) and
 * the BeneficiaryPolicy::update the controller re-checks — the FormRequest
 * owns the shape of the coordinates and the id of the visit being adopted.
 */
class SetBeneficiaryLocationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('beneficiaries.update') ?? false;
    }

    public function rules(): array
    {
        return [
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            // The visit whose captured fix is being adopted — must be one of
            // THIS household's visits with a fix (checked in the controller).
            'field_visit_id' => ['required', 'integer', 'min:1'],
        ];
    }

    public function messages(): array
    {
        return [
            'field_visit_id.required' => 'Choose which visit\'s location to adopt.',
        ];
    }
}
