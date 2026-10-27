<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidatesOwnershipChain;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Create an animal and record its first (`dispersal`) event.
 *
 * The recipient is scoped for a technician: dispersing to a household they are
 * not assigned to is not theirs to do. An admin sees every household.
 */
class StoreDispersalRequest extends FormRequest
{
    use ValidatesOwnershipChain;

    public function authorize(): bool
    {
        return $this->user()->hasPermission('manage_dispersal');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'to_beneficiary_id' => ['required', $this->beneficiaryExistsRule(true)],
            // Human-readable physical tag; unique across animals when present.
            'ear_tag_number' => ['nullable', 'string', 'max:100'],
            'sex' => ['nullable', Rule::in(['M', 'F'])],
            // The master-list species is required for a dispersal; the display
            // string is derived from it server-side when not supplied.
            'animal_type_id' => ['required', 'integer', 'exists:animal_types,id'],
            'classification_id' => ['nullable', 'integer', 'exists:animal_classifications,id'],
            'animal_type' => ['nullable', 'string', 'max:255'],

            ...$this->locationAndDateRules(),
        ];
    }
}
