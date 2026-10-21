<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AssignRoleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('manage_users');
    }

    /**
     * Admin-only role assignment between the staff roles — there is no
     * farmer role, so every account moving through here stays staff.
     */
    public function rules(): array
    {
        return [
            'role' => ['required', 'string', Rule::in(User::ROLES)],
        ];
    }
}
