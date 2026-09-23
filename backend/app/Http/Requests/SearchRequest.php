<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;

class SearchRequest extends FormRequest
{
    /**
     * Every authenticated role may search — what they get back is scoped by
     * SearchService at the query level, the same rule every list endpoint
     * applies. A client-side check is not authorization.
     */
    public function authorize(): bool
    {
        return in_array($this->user()->role, User::ROLES, true);
    }

    protected function prepareForValidation(): void
    {
        // The header form can be submitted with surrounding whitespace (or
        // with only spaces typed), and "  x  " should not defeat the minimum
        // length or pollute the echoed query.
        $this->merge(['q' => trim((string) $this->query('q'))]);
    }

    public function rules(): array
    {
        return [
            // Two characters minimum: a one-letter query matches half the
            // program on a small table and returns noise, not results.
            'q' => ['required', 'string', 'min:2', 'max:100'],
        ];
    }

    public function messages(): array
    {
        return [
            'q.required' => 'Type something to search for.',
            'q.min' => 'Search needs at least 2 characters.',
        ];
    }
}
