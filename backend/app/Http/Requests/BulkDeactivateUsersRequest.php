<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/admin/users/bulk-deactivate — the account ids to deactivate in
 * one request. Per-row outcomes (the actor's own account is a refusal, not a
 * crash) mirror the bulk technician assignment.
 */
class BulkDeactivateUsersRequest extends FormRequest
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
            // 200 is the page cap; a bulk action larger than the table's
            // page size is a client bug, not an operator intention.
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => [
                'required',
                'integer',
                Rule::exists('users', 'id')->whereNull('deleted_at'),
            ],
        ];
    }
}
