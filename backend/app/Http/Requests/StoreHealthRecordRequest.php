<?php

namespace App\Http\Requests;

use App\Models\HealthRecord;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreHealthRecordRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', HealthRecord::class);
    }

    /**
     * The author is never accepted from the client — the attending
     * veterinarian is recorded from the authenticated session.
     */
    public function rules(): array
    {
        return [
            'beneficiary_id' => ['required', Rule::exists('beneficiaries', 'id')],
            'date_recorded' => ['required', 'date', 'before_or_equal:today'],
            'diagnosis' => ['required', 'string', 'max:255'],
            'treatment' => ['nullable', 'string', 'max:2000'],
            'outcome' => ['nullable', 'string', Rule::in(config('cvo.health_outcomes'))],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
