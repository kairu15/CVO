<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreVaccinationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->role === 'technician'
            && $this->user()->hasPermission('health_records.create');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'beneficiary_id' => ['required', Rule::exists('beneficiaries', 'id')],
            'vaccine_name' => ['required', 'string', 'max:120'],
            'administered_on' => ['required', 'date', 'before_or_equal:today'],
            'quantity' => ['required', 'integer', 'min:1', 'max:1000'],
            'batch_number' => ['nullable', 'string', 'max:80'],
            'protocol_days' => ['required', 'integer', 'min:1', 'max:3650'],
            'next_due_on' => ['nullable', 'date', 'after:administered_on'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
