<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET /api/v1/admin/beneficiaries — filter parameters for the admin
 * beneficiary directory (technician assignment screen). Admin-only via both
 * route middleware and this request's authorize().
 */
class AdminBeneficiariesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('assign_technicians');
    }

    protected function failedAuthorization(): never
    {
        abort(403, 'You do not have permission to perform this action.');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:255'],

            // The directory's triage filters. Every one is a WHERE before
            // pagination, so a selection shows the whole matching set and the
            // KPI/worklist counts agree with the rows.
            'barangay' => ['sometimes', 'nullable', 'string', 'max:100'],
            'animal_type' => ['sometimes', 'nullable', 'string', 'max:100'],
            'animal_type_id' => ['sometimes', 'nullable', 'integer', 'exists:animal_types,id'],
            'classification_id' => ['sometimes', 'nullable', 'integer', 'exists:animal_classifications,id'],

            // `unassigned` or a technician id. Numeric strings are allowed
            // because the filter arrives from a URL.
            'assignment' => ['sometimes', 'nullable', 'regex:/^(unassigned|[0-9]+)$/'],
            'monitoring' => ['sometimes', 'nullable', 'in:never,overdue'],
            'missing' => ['sometimes', 'nullable', 'in:rsbsa,ear_tag,location'],

            // The directory groups every household by barangay for bulk
            // assignment and pages through the result. Over-limit values are
            // clamped to 50 by the controller (see App\Support\Pagination),
            // never rejected, and `page` walks the bounded pages.
            'per_page' => ['sometimes', 'integer', 'min:1'],

            'page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
