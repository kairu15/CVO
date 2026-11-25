<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

/**
 * POST /api/v1/reset-password — complete a password reset.
 *
 * Two entry paths share this endpoint:
 *   - a verified reset ticket (the normal "Forgot password?" flow: the emailed
 *     six-digit code is exchanged for `reset_token` at /verify-reset-code), and
 *   - the Laravel password-broker token from an administrator's account
 *     setup invite.
 *
 * Either `reset_token` or `token` is required, but not both together. A bare
 * OTP is deliberately NOT accepted here: it must be verified first, so the
 * password form cannot be reached by skipping verification.
 */
class ResetPasswordRequest extends FormRequest
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
            'token' => ['nullable', 'string', 'required_without:reset_token'],
            'reset_token' => ['nullable', 'string', 'max:128', 'required_without:token'],
            'email' => ['required', 'string', 'email:rfc', 'max:255'],
            'password' => ['required', 'string', Password::defaults(), 'confirmed'],
        ];
    }
}
