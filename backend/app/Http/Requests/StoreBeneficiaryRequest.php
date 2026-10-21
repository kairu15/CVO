<?php

namespace App\Http\Requests;

use App\Models\Beneficiary;
use App\Models\Purok;
use App\Support\Barangays;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreBeneficiaryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Beneficiary::class);
    }

    /**
     * The identity fields of a beneficiary record — the columns the monitoring
     * table auto-fills forever, captured once and validated strictly here. The
     * address is a barangay name from the coverage list; the pin resolves from
     * the name, and the structured barangay id is paired server-side in
     * validated() rather than trusted from the client.
     */
    public function rules(): array
    {
        $rules = [
            'name_of_farmer' => ['required', 'string', 'max:255'],
            'address' => [
                'required',
                'string',
                'max:255',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! Barangays::isCovered((string) $value)) {
                        $fail('Choose a barangay covered by the program: '.implode(', ', Barangays::all()).'.');
                    }
                },
            ],
            'animal_type' => ['required', 'string', 'max:255'],
            // The farmer's national registry ID and the animal's physical tag
            // number. Deliberately loose: RSBSA numbers have no single
            // published format across LGUs/regions, and tags are issued by
            // the office, so a regex here would only reject real data. Blank
            // is normalised to null by prepareForValidation below.
            'rsbsa_number' => ['nullable', 'string', 'max:255'],
            'ear_tag_number' => ['nullable', 'string', 'max:255'],
            'sex' => ['required', Rule::in(['M', 'F'])],
            // Signed Memorandum of Agreement for this dispersal, captured at
            // enrolment when the office already has the paper: null = not yet
            // recorded, true = signed, false = not signed.
            'moa_signed' => ['nullable', 'boolean'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            // Structured location twins of the address string (the admin form's
            // barangay → purok cascade). The purok must belong to the barangay;
            // the store controller resolves the barangay id from the name.
            'location_source' => ['nullable', Rule::in(['gps', 'map_pin', 'manual'])],

            // Optional purok/sitio within the chosen barangay. When given it
            // must actually belong to that barangay — a household's location
            // has to resolve to one consistent place for dispersal tracking.
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
        ];

        return $rules;
    }

    /**
     * Treat a blank RSBSA # / Ear Tag # as "not provided" (null), not as the
     * empty string — so the stored value is honest and the monitoring table's
     * "not yet recorded" placeholder reflects a genuinely absent value.
     */
    protected function prepareForValidation(): void
    {
        foreach (['rsbsa_number', 'ear_tag_number'] as $field) {
            if ($this->has($field)) {
                $this->merge([
                    $field => $this->filled($field) ? trim((string) $this->input($field)) : null,
                ]);
            }
        }
    }

    /**
     * Store the canonical barangay spelling ("banaybanay" -> "Banay Banay").
     *
     * @return array<string, mixed>
     */
    public function validated($key = null, $default = null)
    {
        $validated = parent::validated($key, $default);

        if (array_key_exists('address', $validated) && is_string($validated['address'])) {
            $address = Barangays::normalize($validated['address']);
            $validated['address'] = $address;

            // Pair the free-text address with its structured barangay id
            // server-side, so the two can never disagree.
            $validated['barangay_id'] = Barangays::idFor($address);
        }

        return $validated;
    }
}
