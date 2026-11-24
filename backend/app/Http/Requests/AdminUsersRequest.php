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
            'role' => ['sometimes', 'nullable', Rule::in(User::ROLES)],
            'search' => ['sometimes', 'nullable', 'string', 'max:255'],
            // Accounts that have never completed a sign-in — the onboarding
            // worklist (invited staff whose setup link is still pending).
            'never_signed_in' => ['sometimes', 'boolean'],
            // Three sort keys are enough to answer "who is newest", "who is
            // overdue for a sign-in", and the default alphabetical scan.
            'sort' => ['sometimes', 'nullable', Rule::in(['name', 'created_at', 'last_login_at'])],
            'dir' => ['sometimes', 'nullable', Rule::in(['asc', 'desc'])],
            // Which account states to include. Defaults to `active` so the
            // technician pickers (which share this endpoint) can never offer a
            // deactivated technician; User Management asks for `all` so
            // deactivated accounts stay visible and reactivatable.
            'status' => ['sometimes', 'nullable', Rule::in(['active', 'deactivated', 'all'])],
            // Which PRESENCE the table is showing — a separate axis from
            // `status`: "offline" includes enabled accounts nobody is using,
            // while deactivated accounts are always offline (they hold no
            // live session) but keep their own badge in the UI. Filtered in
            // SQL by the User::scopeOnline/scopeOffline rule.
            'presence' => ['sometimes', 'nullable', Rule::in(['online', 'offline'])],
            // Page size, clamped to 50 by the controller
            // (App\Support\Pagination); `page` walks the bounded pages.
            'per_page' => ['sometimes', 'integer', 'min:1'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
