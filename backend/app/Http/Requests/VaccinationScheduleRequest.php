<?php

namespace App\Http\Requests;

use App\Models\User;
use App\Services\VaccinationScheduleService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class VaccinationScheduleRequest extends FormRequest
{
    /**
     * Read-only derived view: every authenticated staff role may read it,
     * scoped server-side by BeneficiaryService.
     */
    public function authorize(): bool
    {
        return in_array($this->user()->role, User::ROLES, true);
    }

    public function rules(): array
    {
        return [
            'status' => ['sometimes', 'string', Rule::in(VaccinationScheduleService::STATUSES)],
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'barangay' => ['sometimes', 'nullable', 'string', 'max:120'],
            'sort' => ['sometimes', Rule::in(['due', 'name', 'last_vaccination', 'barangay'])],
            'direction' => ['sometimes', Rule::in(['asc', 'desc'])],
            'per_page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
