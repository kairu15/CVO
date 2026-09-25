<?php

namespace App\Http\Requests;

use App\Models\Purok;
use App\Models\User;
use App\Support\Barangays;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * PATCH /profile — the authenticated user editing their own account.
 *
 * Everything is scoped to the caller: no user id is accepted, so one
 * account can never write another's profile by manipulating the payload.
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

            // Farmer location — same rules as registration. The barangay is
            // a name from the coverage list; the purok must belong to it.
            'address' => [
                'sometimes',
                'required_with:purok_id,latitude,longitude,location_source',
                'nullable',
                'string',
                'max:255',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value !== null && $this->user()->isFarmer() && ! Barangays::isCovered($value)) {
                        $fail('Choose a barangay covered by the program: '.implode(', ', Barangays::all()).'.');
                    }
                },
            ],
            'purok_id' => [
                'sometimes',
                'nullable',
                'integer',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value === null) {
                        return;
                    }

                    $purok = Purok::query()->find($value);

                    if (! $purok) {
                        $fail('Choose a purok/sitio from the list.');

                        return;
                    }

                    $barangayId = Barangays::idFor(
                        Barangays::normalize((string) ($this->input('address') ?? '')),
                    );

                    if ($barangayId === null || $purok->barangay_id !== $barangayId) {
                        $fail('The selected purok does not belong to the chosen barangay.');
                    }
                },
            ],
            'latitude' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'location_source' => ['sometimes', 'nullable', Rule::in(['gps', 'map_pin', 'manual'])],
        ];
    }

    /**
     * Normalise the barangay name so "Banay Banay " matches the coverage list.
     */
    protected function prepareForValidation(): void
    {
        if ($this->has('address')) {
            $this->merge(['address' => trim((string) $this->input('address'))]);
        }
    }

    /**
     * Account fields, location already resolved to a barangay id server-side.
     *
     * @return array<string, mixed>
     */
    public function validated($key = null, $default = null)
    {
        $validated = parent::validated();

        if (array_key_exists('address', $validated)) {
            $address = Barangays::normalize($validated['address'] ?? '');
            $validated['address'] = $address;
            $validated['barangay_id'] = $address !== '' ? Barangays::idFor($address) : null;
        }

        return $validated;
    }
}
