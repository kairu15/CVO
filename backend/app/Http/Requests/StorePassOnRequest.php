<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidatesOwnershipChain;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Pass an offspring of an animal on to a new beneficiary. The offspring is a
 * NEW animal linked to the parent via `parent_animal_id`; the parent's own
 * ownership is untouched.
 *
 * The animal-type pair is optional — an offspring that is not explicitly typed
 * inherits its parent's type (and drops any classification that would not
 * belong to it).
 */
class StorePassOnRequest extends FormRequest
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
            'to_beneficiary_id' => ['required', $this->beneficiaryExistsRule(false)],
            'base_event_id' => ['nullable', 'integer'],
            'ear_tag_number' => ['nullable', 'string', 'max:100'],
            'sex' => ['nullable', Rule::in(['M', 'F'])],
            'animal_type_id' => ['nullable', 'integer', 'exists:animal_types,id'],
            'classification_id' => ['nullable', 'integer', 'exists:animal_classifications,id'],
            'animal_type' => ['nullable', 'string', 'max:255'],

            ...$this->locationAndDateRules(),
        ];
    }
}
