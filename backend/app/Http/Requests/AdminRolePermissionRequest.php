<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH /api/v1/admin/roles/{role}/permissions — flip one cell of the
 * capability matrix. Requires the manage_roles capability (route middleware);
 * this request validates the cell coordinates.
 */
class AdminRolePermissionRequest extends FormRequest
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
            'permission' => ['required', 'string', 'exists:permissions,key'],
            'granted' => ['required', 'boolean'],
        ];
    }

    public function prepareForValidation(): void
    {
        // The role rides in the path, not the body — merge it so the same
        // rules validate both.
        $this->merge(['role' => $this->route('role')]);
    }

    public function messages(): array
    {
        return [
            'permission.exists' => 'Unknown permission.',
        ];
    }
}
