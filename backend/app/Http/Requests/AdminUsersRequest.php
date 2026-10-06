<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/admin/users — filter parameters (item 5). Admin-only via both
 * route middleware and this request's authorize().
 */
class AdminUsersRequest extends FormRequest
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
            'role' => ['sometimes', 'nullable', Rule::in(User::ROLES)],
            'search' => ['sometimes', 'nullable', 'string', 'max:255'],
            // Which account states to include. Defaults to `active` so the
            // technician pickers (which share this endpoint) can never offer a
            // deactivated technician; User Management asks for `all` so
            // deactivated accounts stay visible and reactivatable.
            'status' => ['sometimes', 'nullable', Rule::in(['active', 'deactivated', 'all'])],
            // Page size, clamped to 50 by the controller
            // (App\Support\Pagination); `page` walks the bounded pages.
            'per_page' => ['sometimes', 'integer', 'min:1'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
