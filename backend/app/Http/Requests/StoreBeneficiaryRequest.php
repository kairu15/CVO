<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreBeneficiaryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', \App\Models\Beneficiary::class);
    }

    /**
     * Rules for the identity fields captured at farmer registration. These
     * four columns are the ones the monitoring table auto-fills forever, so
     * they are captured once and validated strictly here.
     *
     * `farmer_id` is only honoured for admin/technician requests (registering
     * on behalf of a farmer); farmers always own their own records.
     */
    public function rules(): array
    {
        $rules = [
            'name_of_farmer' => ['required', 'string', 'max:255'],
            'address' => ['required', 'string', 'max:255'],
            'animal_type' => ['required', 'string', 'max:255'],
            'sex' => ['required', Rule::in(['M', 'F'])],
        ];

        if (in_array($this->user()->role, ['admin', 'technician'], true)) {
            $rules['farmer_id'] = ['nullable', Rule::exists(User::class, 'id')->where('role', 'farmer')];
        }

        return $rules;
    }
}
