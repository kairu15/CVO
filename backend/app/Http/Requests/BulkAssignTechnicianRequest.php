<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * One transactional request assigning (or clearing) a technician on many
 * beneficiaries at once — the bulk counterpart of AssignTechnicianRequest.
 */
class BulkAssignTechnicianRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->role === 'admin';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', Rule::exists('beneficiaries', 'id')],
            'technician_id' => [
                'nullable',
                Rule::exists('users', 'id')->where('role', 'technician'),
            ],
        ];
    }
}
