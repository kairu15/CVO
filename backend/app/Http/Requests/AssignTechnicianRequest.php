<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AssignTechnicianRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('assign_technicians');
    }

    /**
     * Attach or detach (null) the technician on a beneficiary. The user must
     * actually hold the technician role — assigning, say, an administrator as
     * the responsible technician would break the technician's scoped queries.
     */
    public function rules(): array
    {
        return [
            'technician_id' => [
                'nullable',
                // Deactivated accounts are soft-deleted rows; an exists check
                // without the deleted_at guard would still let an admin
                // assign new work to a technician who cannot sign in.
                Rule::exists('users', 'id')
                    ->where('role', 'technician')
                    ->whereNull('deleted_at'),
            ],
        ];
    }
}
