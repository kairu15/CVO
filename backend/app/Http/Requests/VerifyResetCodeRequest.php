<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/verify-reset-code — check a six-digit password reset code.
 *
 * Shape is checked here (so an obviously malformed code costs no database
 * work); a well-formed but wrong/expired/used code is answered by the service
 * with the same uniform message, so the client cannot distinguish the cases.
 */
class VerifyResetCodeRequest extends FormRequest
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
            'otp' => ['required', 'string', 'max:20'],
        ];
    }
}
