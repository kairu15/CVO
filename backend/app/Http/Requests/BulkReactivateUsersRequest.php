<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/admin/users/bulk-reactivate — restore the selected dormant
 * accounts. Only soft-deleted rows are valid targets; the service still
 * refuses non-staff roles, so a retired farmer row cannot be revived even by
 * guessing its id.
 */
class BulkReactivateUsersRequest extends FormRequest
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
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => [
                'required',
                'integer',
                Rule::exists('users', 'id')->whereNotNull('deleted_at'),
            ],
        ];
    }
}
