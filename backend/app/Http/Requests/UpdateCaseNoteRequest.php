<?php

namespace App\Http\Requests;

use App\Models\CaseNote;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCaseNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        $note = CaseNote::find($this->route('case_note'));

        return $note && $this->user()->can('update', $note);
    }

    /**
     * Patch semantics. `beneficiary_id` is absent for the same reason it is on
     * health records: a case belongs to one animal, and moving it would
     * silently rewrite that animal's history.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'date_noted' => ['sometimes', 'date', 'before_or_equal:today'],
            'category' => ['sometimes', Rule::in(CaseNote::CATEGORIES)],
            'status' => ['sometimes', Rule::in(CaseNote::STATUSES)],
            'location' => ['nullable', 'string', 'max:255'],
            'body' => ['sometimes', 'string', 'max:5000'],
            'actions_taken' => ['nullable', 'string', 'max:5000'],
            'recommendations' => ['nullable', 'string', 'max:5000'],
            'follow_up_on' => ['nullable', 'date'],
            'follow_up_completed' => ['sometimes', 'boolean'],
            'health_record_id' => ['nullable', 'integer', Rule::exists('health_records', 'id')],
            'field_visit_id' => ['nullable', 'integer', Rule::exists('field_visits', 'id')],
        ];
    }
}
