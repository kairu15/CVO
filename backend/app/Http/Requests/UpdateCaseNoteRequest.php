<?php

namespace App\Http\Requests;

use App\Models\CaseNote;
use Illuminate\Foundation\Http\FormRequest;

class UpdateCaseNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        $note = CaseNote::find($this->route('case_note'));

        return $note && $this->user()->can('update', $note);
    }

    /**
     * Patch semantics. `beneficiary_id` is absent for the same reason it is on
     * health records: a note belongs to one animal, and moving it would
     * silently rewrite that animal's history.
     */
    public function rules(): array
    {
        return [
            'date_noted' => ['sometimes', 'date', 'before_or_equal:today'],
            'body' => ['sometimes', 'string', 'max:5000'],
        ];
    }
}
