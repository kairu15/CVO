<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateMonitoringRecordRequest extends FormRequest
{
    public function authorize(): bool
    {
        $record = \App\Models\MonitoringRecord::find($this->route('monitoring_record'));

        return $record && $this->user()->can('update', $record);
    }

    /**
     * Patch semantics: every visit field is optional. Identity fields are
     * still never accepted — they live on the beneficiary only.
     */
    public function rules(): array
    {
        return [
            'date_monitored' => ['sometimes', 'date', 'before_or_equal:today'],
            'date_vits_supp' => ['nullable', 'date'],
            'deworming_date' => ['nullable', 'date'],
            'vaccination_date' => ['nullable', 'date'],
            'date_breed' => ['nullable', 'date'],
            'date_calved' => ['nullable', 'date'],
            'bcs' => ['nullable', 'integer', 'between:1,5'],
            'farmers_signature' => ['nullable', 'string', 'max:255'],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
