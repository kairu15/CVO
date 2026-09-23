<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AnimalHealthRequest extends FormRequest
{
    /**
     * Read-only derived view: every authenticated role may read it, and
     * BeneficiaryService limits the rows to the animals that role owns.
     *
     * No Policy because there is no model to authorize against — the same
     * shape as VaccinationScheduleRequest and AssignRoleRequest.
     */
    public function authorize(): bool
    {
        return in_array($this->user()->role, User::ROLES, true);
    }

    public function rules(): array
    {
        return [
            // "attention" narrows to animals with an overdue or missing
            // vaccination, or at least one open case. Anything else is a 422
            // rather than a silently ignored parameter.
            'filter' => ['sometimes', 'string', Rule::in(['attention'])],
            'per_page' => ['sometimes', 'integer', 'between:1,200'],
        ];
    }
}
