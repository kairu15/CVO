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
     * The author is never accepted from the client — the signing technician is
     * taken from the authenticated session.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'beneficiary_id' => ['required', Rule::exists('beneficiaries', 'id')],
            'date_noted' => ['required', 'date', 'before_or_equal:today'],
            'category' => ['sometimes', Rule::in(CaseNote::CATEGORIES)],
            'status' => ['sometimes', Rule::in(CaseNote::STATUSES)],
            'location' => ['nullable', 'string', 'max:255'],
            'body' => ['required', 'string', 'max:5000'],
            'actions_taken' => ['nullable', 'string', 'max:5000'],
            'recommendations' => ['nullable', 'string', 'max:5000'],
            'follow_up_on' => ['nullable', 'date', 'after_or_equal:date_noted'],
            'health_record_id' => ['nullable', 'integer', Rule::exists('health_records', 'id')],
            'field_visit_id' => ['nullable', 'integer', Rule::exists('field_visits', 'id')],
        ];
    }
}
