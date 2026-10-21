<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH /profile — the authenticated user editing their own account.
 *
 * Only the account fields (name/email) are writable: every role is a staff
 * account now, and a beneficiary's household location is corrected on the
 * admin Beneficiaries screen, not from a personal profile.
 *
 * Everything is scoped to the caller: no user id is accepted, so one account
 * can never write another's profile by manipulating the payload.
 */
class UpdateProfileRequest extends FormRequest
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
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => [
                'sometimes',
                'required',
                'string',
                'lowercase',
                'email:rfc',
                'max:255',
                Rule::unique(User::class)->ignore($this->user()->id),
            ],
        ];
    }
}
