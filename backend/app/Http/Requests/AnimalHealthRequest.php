<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class AnimalHealthRequest extends FormRequest
{
    /**
     * Read-only derived view: every authenticated role may read it, and
     * BeneficiaryService limits the rows to the animals that role owns.
     */
    public function authorize(): bool
    {
        return in_array($this->user()->role, User::ROLES, true);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'search' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', Rule::in(['healthy', 'observation', 'attention', 'unrecorded'])],
            'filter' => ['sometimes', 'string', Rule::in(['attention'])],
            'barangay' => ['nullable', 'string', 'max:120'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'sort' => ['nullable', Rule::in(['urgency', 'name', 'barangay', 'status', 'examination'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
            'per_page' => ['sometimes', 'integer', 'min:1'],
        ];
    }

    /**
     * A trend date range must run forwards. Swapping silently would make the
     * chart claim a different window than the one the technician picked.
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($this->filled('from')
                    && $this->filled('to')
                    && $this->input('from') > $this->input('to')) {
                    $validator->errors()->add('to', 'The end date must be on or after the start date.');
                }
            },
        ];
    }
}
