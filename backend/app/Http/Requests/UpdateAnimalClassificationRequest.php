<?php

namespace App\Http\Requests;

use App\Models\AnimalClassification;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/admin/animal-classifications/{animalClassification}.
 *
 * A classification can be renamed and reordered but never moved to another
 * type: records already point at it as (type, classification), and moving it
 * would silently reclassify every animal using it.
 */
class UpdateAnimalClassificationRequest extends FormRequest
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
        $classification = $this->route('animalClassification');
        $typeId = $classification instanceof AnimalClassification ? $classification->animal_type_id : null;

        return [
            'name' => [
                'sometimes',
                'string',
                'min:1',
                'max:100',
                function (string $attribute, mixed $value, \Closure $fail) use ($classification, $typeId): void {
                    $exists = AnimalClassification::query()
                        ->where('animal_type_id', $typeId)
                        ->where('id', '!=', $classification?->id)
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
