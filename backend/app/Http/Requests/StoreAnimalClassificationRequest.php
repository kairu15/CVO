<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/admin/animal-types/{animalType}/classifications.
 *
 * Uniqueness is per type (Boar legitimately exists under Swine and Guinea
 * pig), so the rule is a scoped unique, not a global one.
 */
class StoreAnimalClassificationRequest extends FormRequest
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
        $typeId = $this->route('animalType')?->id;

        return [
            'name' => [
                'required',
                'string',
                'min:1',
                'max:100',
                function (string $attribute, mixed $value, \Closure $fail) use ($typeId): void {
                    $exists = \App\Models\AnimalClassification::query()
                        ->where('animal_type_id', $typeId)
                        ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim((string) $value))])
                        ->exists();

                    if ($exists) {
                        $fail('That classification already exists for this animal type.');
                    }
                },
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
