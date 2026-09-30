<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreSymptomRuleRequest extends FormRequest
{
    /**
     * Editing the hint table is admin-only. The route sits under
     * EnsureUserIsAdmin already; this is the second gate, not the only one.
     */
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
            'label' => ['required', 'string', 'max:120'],
            // One keyword or phrase per entry. Multi-word entries match the
            // exact phrase, which is how symptom combinations are expressed.
            'keywords' => ['required', 'array', 'min:1', 'max:20'],
            // Each entry may be null/blank; the service trims and drops those
            // rather than the request rejecting the whole payload over a
            // trailing comma in the editor.
            'keywords.*' => ['nullable', 'string', 'max:80'],
            'hint' => ['required', 'string', 'max:500'],
            // Null (or blank) means the rule applies to every animal type.
            'animal_type' => ['nullable', 'string', 'max:50'],
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
        ];
    }
}
