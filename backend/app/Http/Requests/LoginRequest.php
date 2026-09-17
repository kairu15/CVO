<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class LoginRequest extends FormRequest
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
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'identifier' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string'],
            'remember' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * Allow the pre-username field name to keep working, so existing
     * clients that post "email" are not broken by the rename.
     */
    protected function prepareForValidation(): void
    {
        if (! $this->has('identifier') && $this->has('email')) {
            $this->merge(['identifier' => $this->input('email')]);
        }
    }
}
