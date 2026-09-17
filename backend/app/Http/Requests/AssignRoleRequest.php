<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AssignRoleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->role === 'admin';
    }

    /**
     * Admin-only role assignment. Self-registration creates farmers; only
     * this request may elevate an account to a staff role.
     */
    public function rules(): array
    {
        return [
            'role' => ['required', 'string', Rule::in(User::ROLES)],
        ];
    }
}
