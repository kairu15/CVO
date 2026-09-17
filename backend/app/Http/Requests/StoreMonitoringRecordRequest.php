<?php

namespace App\Http\Requests;

use App\Models\MonitoringRecord;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreMonitoringRecordRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', MonitoringRecord::class);
    }

    /**
     * Visit-specific fields only. The identity fields (name of farmer,
     * address, animal type, sex) are never accepted here — they come from the
     * beneficiary record, so a technician cannot retype or alter them.
     */
    public function rules(): array
    {
        return [
            'beneficiary_id' => [
                'required',
                Rule::exists('beneficiaries', 'id'),
            ],
            'date_monitored' => ['required', 'date', 'before_or_equal:today'],
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

    /**
     * The technician must actually be assigned to the beneficiary they are
     * logging a visit for — checked here so the API returns a clean 422
     * instead of a policy 403 that the form cannot render field-level.
     */
    public function withValidator($validator): void
    {
        $validator->after(function ($validator): void {
            $beneficiaryId = $this->integer('beneficiary_id');
            if (! $beneficiaryId) {
                return;
            }

            $beneficiary = \App\Models\Beneficiary::find($beneficiaryId);

            if ($beneficiary && $beneficiary->technician_id !== $this->user()->id) {
                $validator->errors()->add(
                    'beneficiary_id',
                    'You are not assigned to this beneficiary.',
                );
            }
        });
    }
}
