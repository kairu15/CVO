<?php

namespace App\Http\Requests;

use App\Models\HealthRecord;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateHealthRecordRequest extends FormRequest
{
    public function authorize(): bool
    {
        $record = HealthRecord::find($this->route('health_record'));

        return $record && $this->user()->can('update', $record);
    }

    /**
     * Patch semantics: every field is optional.
     *
     * `beneficiary_id` is deliberately absent — a clinical record is about one
     * animal, and moving it to another would silently rewrite that animal's
     * history. Delete and re-create instead.
     */
    public function rules(): array
    {
        return [
            'date_recorded' => ['sometimes', 'date', 'before_or_equal:today'],
            'diagnosis' => ['sometimes', 'string', 'max:255'],
            'treatment' => ['nullable', 'string', 'max:2000'],
            'outcome' => ['nullable', 'string', Rule::in(config('cvo.health_outcomes'))],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
