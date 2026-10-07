<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * POST /api/v1/admin/users — create a staff account.
 *
 * Admin-only via both route middleware and this request's authorize(), so a
 * technician or doctor calling the endpoint directly gets a 403 rather than
 * merely failing to see the button.
 */
class AdminUserStoreRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email:rfc', 'max:255', Rule::unique(User::class)],
            // Staff roles only — self-registration is the farmer path, and it
            // creates the beneficiary record this screen cannot.
            'role' => ['required', 'string', Rule::in(User::STAFF_ROLES)],
            // OPTIONAL — the invite path. Sent: the account signs in with it
            // (same policy as registration: min 8, mixed case, number,
            // symbol, confirmed so a typo cannot lock the person out).
            // Omitted: the account is created passwordless and receives a
            // one-time setup link to set their own password.
            'password' => ['nullable', 'string', Password::defaults(), 'confirmed'],
        ];
    }

    /**
     * Normalise the email so "Admin@Example.com" and "admin@example.com"
     * collide as the unique rule expects — same treatment the registration
     * request gives usernames.
     */
    protected function prepareForValidation(): void
    {
        if ($this->has('email')) {
            $this->merge(['email' => mb_strtolower(trim((string) $this->input('email')))]);
        }
    }
}
