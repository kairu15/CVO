<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

/**
 * POST /api/v1/reset-password — complete a password reset.
 *
 * Two entry paths share this endpoint:
 *   - a six-digit emailed OTP (the normal "Forgot password?" flow), and
 *   - the Laravel password-broker token from an administrator's account
 *     setup invite.
 *
 * Either `otp` or `token` is required, but not both together.
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
            'token' => ['nullable', 'string', 'required_without:otp'],
            // Length/shape is checked by PasswordResetOtpService too, but not
            // here: every invalid, expired, used or over-attempted code must
            // get the SAME 422 message on the otp field (not Laravel's
            // "must be 6 digits" message).
            'otp' => ['nullable', 'string', 'max:20', 'required_without:token'],
            'email' => ['required', 'string', 'email:rfc', 'max:255'],
            'password' => ['required', 'string', Password::defaults(), 'confirmed'],
        ];
    }
}
