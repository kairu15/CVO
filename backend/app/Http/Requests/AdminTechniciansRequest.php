<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/admin/technicians — the directory's filters.
 *
 * The page is part of account management, so the same `manage_users`
 * capability gates this request and its route.
 */
class AdminTechniciansRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('manage_users');
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
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'status' => ['sometimes', 'nullable', Rule::in(['active', 'deactivated', 'all'])],
            'barangay' => ['sometimes', 'nullable', 'string', 'max:120'],
            'workload' => ['sometimes', 'nullable', Rule::in(['unassigned', 'light', 'moderate', 'heavy'])],
            'per_page' => ['sometimes', 'integer', 'min:1'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
