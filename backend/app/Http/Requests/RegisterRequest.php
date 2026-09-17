<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class RegisterRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * Note there is deliberately no "role" rule: self-registration always
     * produces a farmer, so any role sent in the payload is ignored.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'username' => [
                'required',
                'string',
                'lowercase',
                'alpha_dash',
                'min:3',
                'max:30',
                Rule::unique(User::class),
            ],
            'email' => ['required', 'string', 'lowercase', 'email:rfc', 'max:255', Rule::unique(User::class)],
            'password' => ['required', 'string', Password::defaults(), 'confirmed'],

            // Optional dispersal details — when present they create the
            // beneficiary record that monitoring auto-fills from. Either all
            // three of address/animal/sex are given or none.
            'name_of_farmer' => ['sometimes', 'string', 'max:255'],
            'address' => ['required_with:animal_type', 'nullable', 'string', 'max:255'],
            'animal_type' => ['required_with:address', 'nullable', 'string', 'max:255'],
            'sex' => ['required_with:address', Rule::in(['M', 'F', ''])],
        ];
    }

    /**
     * Normalise the username before validation so "Juan_Dela" and
     * "juan_dela" collide as expected.
     */
    protected function prepareForValidation(): void
    {
        if ($this->has('username')) {
            $this->merge(['username' => mb_strtolower(trim((string) $this->input('username')))]);
        }
    }

    /**
     * Make the "dispersal" sub-object available as an array for the service
     * layer after validation.
     *
     * @return array<string, mixed>
     */
    public function validated($key = null, $default = null)
    {
        $validated = parent::validated();

        $dispersal = [
            'name_of_farmer' => $validated['name_of_farmer'] ?? '',
            'address' => $validated['address'] ?? '',
            'animal_type' => $validated['animal_type'] ?? '',
            'sex' => $validated['sex'] ?? '',
        ];

        unset(
            $validated['name_of_farmer'],
            $validated['address'],
            $validated['animal_type'],
            $validated['sex'],
        );

        $validated['dispersal'] = array_filter($dispersal, fn ($v) => $v !== '') ?: null;

        return $validated;
    }
}
