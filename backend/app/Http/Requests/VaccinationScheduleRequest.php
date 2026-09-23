<?php

namespace App\Http\Requests;

use App\Models\User;
use App\Services\VaccinationScheduleService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class VaccinationScheduleRequest extends FormRequest
{
    /**
     * Read-only derived view: every authenticated role may read it, and
     * BeneficiaryService limits the rows to the animals that role owns.
     *
     * There is no Policy because there is no model to authorize against — the
     * same shape as AssignRoleRequest, which is also a bare role check.
     */
    public function authorize(): bool
    {
        return in_array($this->user()->role, User::ROLES, true);
    }

    public function rules(): array
    {
        return [
            'status' => ['sometimes', 'string', Rule::in(VaccinationScheduleService::STATUSES)],
            'per_page' => ['sometimes', 'integer', 'between:1,200'],
        ];
    }
}
