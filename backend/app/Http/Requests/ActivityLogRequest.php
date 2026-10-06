<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET /api/v1/admin/activity-logs — filters for the audit log dashboard.
 *
 * Read-only (item 7); only shapes the query, never mutates anything.
 */
class ActivityLogRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null && $this->user()->role === 'admin';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'action' => ['sometimes', 'nullable', 'string', 'max:64'],
            'actor_id' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'date_from' => ['sometimes', 'nullable', 'date'],
            'date_to' => ['sometimes', 'nullable', 'date', 'after_or_equal:date_from'],
            'search' => ['sometimes', 'nullable', 'string', 'max:255'],
            // Over-limit values are clamped to 50 by the controller
            // (App\Support\Pagination), matching every other list endpoint.
            'per_page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
