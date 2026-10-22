<?php

namespace App\Http\Requests;

use App\Models\AnimalType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH /api/v1/admin/animal-types/{animalType} — rename, move to another
 * category, or reorder (the settings screen's up/down controls write
 * `sort_order`).
 *
 * The type is addressed through the route's model binding, so changing only
 * the order needs no name at all.
 */
class UpdateAnimalTypeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('manage_reference_data') ?? false;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $type = $this->route('animalType');

        return [
            'main_category' => ['sometimes', Rule::in(AnimalType::MAIN_CATEGORIES)],
            'name' => [
                'sometimes',
                'string',
                'min:1',
                'max:100',
                Rule::unique('animal_types', 'name')->ignore($type instanceof AnimalType ? $type->id : $type),
            ],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if ($this->has('name')) {
            $this->merge(['name' => trim((string) $this->input('name'))]);
        }
    }
}
