<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH /profile — the authenticated user editing their own account.
 *
 * Name, email, personal phone and personal address are writable. These contact
 * fields belong to the staff account; a beneficiary's household location is
 * still corrected on the admin Beneficiaries screen. Role, username and
 * permissions are deliberately absent, so a profile edit can never escalate an
 * account.
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
            'phone' => [
                'sometimes',
                'nullable',
                'string',
                'max:32',
                'regex:/^[0-9+()\-\s.]{7,32}$/',
            ],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }
}
