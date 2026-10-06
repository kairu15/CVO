<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH /api/v1/admin/users/{id} — edit an account's name, email and role.
 *
 * Admin-only. The role, when sent and actually different, is applied through
 * UserRoleService, so the "an admin cannot change their own role" rule is the
 * same one the dedicated role endpoint enforces (and shows up here as a 422
 * keyed on `role`).
 */
class AdminUserUpdateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->role === 'admin';
    }

    protected function failedAuthorization(): never
    {
        abort(403, 'Administrator access required.');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            // Deactivated accounts still hold their email in the table (they
            // are soft-deleted, not removed), so the ignore() is what keeps an
            // edited account from colliding with itself.
            'email' => [
                'required',
                'string',
                'email:rfc',
                'max:255',
                Rule::unique(User::class)->ignore($this->route('id')),
            ],
            'role' => ['sometimes', 'nullable', 'string', Rule::in(User::ROLES)],
        ];
    }

    protected function prepareForValidation(): void
    {
        if ($this->has('email')) {
            $this->merge(['email' => mb_strtolower(trim((string) $this->input('email')))]);
        }
    }
}
