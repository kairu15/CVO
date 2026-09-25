<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

/**
 * PATCH /profile/password — the caller changing their own password.
 *
 * Follows the same password rules as registration (Password::defaults():
 * min 8, mixed case, number, symbol) and requires the current password so a
 * borrowed browser session cannot silently take the account over.
 */
class UpdatePasswordRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'current_password' => ['required', 'string', 'current_password:sanctum'],
            'password' => ['required', 'string', Password::defaults(), 'confirmed'],
        ];
    }
}
