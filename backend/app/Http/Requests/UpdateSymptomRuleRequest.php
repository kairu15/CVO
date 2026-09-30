<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateSymptomRuleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->role === 'admin';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'label' => ['sometimes', 'string', 'max:120'],
            'keywords' => ['sometimes', 'array', 'min:1', 'max:20'],
            'keywords.*' => ['nullable', 'string', 'max:80'],
            'hint' => ['sometimes', 'string', 'max:500'],
            'animal_type' => ['sometimes', 'nullable', 'string', 'max:50'],
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
        ];
    }
}
