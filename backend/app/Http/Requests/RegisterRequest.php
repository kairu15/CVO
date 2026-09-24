<?php

namespace App\Http\Requests;

use App\Models\Purok;
use App\Models\User;
use App\Support\Barangays;
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
            // three of address/animal/sex are given or none. The address is
            // a barangay name from the program's coverage list — the pin is
            // resolved from the name, users never type coordinates.
            'name_of_farmer' => ['sometimes', 'string', 'max:255'],
            'address' => [
                'required_with:animal_type',
                'nullable',
                'string',
                'max:255',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value !== null && ! Barangays::isCovered($value)) {
                        $fail('Choose a barangay covered by the program: '.implode(', ', Barangays::all()).'.');
                    }
                },
            ],
            'animal_type' => ['required_with:address', 'nullable', 'string', 'max:255'],
            'sex' => ['required_with:address', Rule::in(['M', 'F', ''])],

            // Optional purok/sitio within the chosen barangay. When given it
            // must actually belong to that barangay — a farmer's location has
            // to resolve to one consistent place for dispersal tracking.
            'purok_id' => [
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
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
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

        $address = isset($validated['address'])
            ? Barangays::normalize($validated['address'])
            : '';

        $dispersal = [
            'name_of_farmer' => $validated['name_of_farmer'] ?? '',
            'address' => $address,
            'animal_type' => $validated['animal_type'] ?? '',
            'sex' => $validated['sex'] ?? '',
            'latitude' => $validated['latitude'] ?? null,
            'longitude' => $validated['longitude'] ?? null,

            // The structured location twins of the address string. The
            // barangay id is resolved server-side from the (normalized) name
            // so a client cannot pair the name with a foreign id.
            'barangay_id' => $address !== '' ? Barangays::idFor($address) : null,
            'purok_id' => $validated['purok_id'] ?? null,
        ];

        unset(
            $validated['name_of_farmer'],
            $validated['address'],
            $validated['animal_type'],
            $validated['sex'],
            $validated['latitude'],
            $validated['longitude'],
            $validated['purok_id'],
        );

        $validated['dispersal'] = array_filter($dispersal, fn ($v) => $v !== '') ?: null;

        return $validated;
    }
}
