<?php

namespace App\Http\Requests;

use App\Models\CaseNote;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCaseNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', CaseNote::class);
    }

    /**
     * The author is never accepted from the client — the signing vet is taken
     * from the authenticated session.
     */
    public function rules(): array
    {
        return [
            'beneficiary_id' => ['required', Rule::exists('beneficiaries', 'id')],
            'date_noted' => ['required', 'date', 'before_or_equal:today'],
            'body' => ['required', 'string', 'max:5000'],
        ];
    }
}
