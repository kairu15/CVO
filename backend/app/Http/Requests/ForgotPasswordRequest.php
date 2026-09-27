<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/forgot-password — request a password reset link.
 *
 * The rule list is intentionally minimal: revealing stricter validation
 * (e.g. "must be a covered address") would itself leak information about
 * which emails exist. Anything that is not a plausible address simply never
 * matches a user and gets the uniform "sent" answer.
 */
class ForgotPasswordRequest extends FormRequest
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
            'email' => ['required', 'string', 'email:rfc', 'max:255'],
        ];
    }
}
