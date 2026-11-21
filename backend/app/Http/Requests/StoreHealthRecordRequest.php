<?php

namespace App\Http\Requests;

use App\Models\HealthRecord;
use App\Services\SettingsService;
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
            'animal_quantity' => ['sometimes', 'integer', 'min:1', 'max:1000'],
            'date_recorded' => ['required', 'date', 'before_or_equal:today'],
            'diagnosis' => ['required', 'string', 'max:255'],
            'symptoms' => ['nullable', 'string', 'max:2000'],
            'treatment' => ['nullable', 'string', 'max:2000'],
            'outcome' => ['nullable', 'string', Rule::in(app(SettingsService::class)->healthOutcomes())],
            'follow_up_on' => ['nullable', 'date', 'after_or_equal:date_recorded'],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
