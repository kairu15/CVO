<?php

namespace App\Http\Requests;

use App\Models\Permission;
use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH /api/v1/admin/roles/{role}/permissions/bulk
 *
 * Apply one grant/revoke decision to a whole group of capabilities in ONE
 * transaction. Used by the matrix's group actions; every changed grant still
 * gets its own audit row.
 */
class AdminRolePermissionsBulkRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('manage_roles');
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
            'role' => [Rule::in(User::ROLES)],
            'permission_keys' => ['required', 'array', 'min:1'],
            'permission_keys.*' => ['required', 'string', 'distinct', Rule::exists(Permission::class, 'key')],
            'granted' => ['required', 'boolean'],
        ];
    }

    public function prepareForValidation(): void
    {
        $this->merge(['role' => $this->route('role')]);
    }

    public function messages(): array
    {
        return [
            'permission_keys.*.exists' => 'One of the selected permissions no longer exists.',
        ];
    }
}
