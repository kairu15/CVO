<?php

namespace App\Http\Requests;

use App\Models\AnimalType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/admin/animal-types — an administrator adds a species the
 * shipped master list did not anticipate.
 */
class StoreAnimalTypeRequest extends FormRequest
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
        return [
            'main_category' => ['required', Rule::in(AnimalType::MAIN_CATEGORIES)],
            'name' => ['required', 'string', 'min:1', 'max:100', 'unique:animal_types,name'],
            // Optional; defaults to the end of its category.
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
