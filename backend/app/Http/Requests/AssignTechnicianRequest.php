<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AssignTechnicianRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->role === 'admin';
    }

    /**
     * Attach or detach (null) the technician on a beneficiary. The user must
     * actually hold the technician role — assigning, say, a farmer as the
     * responsible technician would break the technician's scoped queries.
     */
    public function rules(): array
    {
        return [
            'technician_id' => [
                'nullable',
                Rule::exists('users', 'id')->where('role', 'technician'),
            ],
        ];
    }
}
