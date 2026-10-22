<?php

namespace App\Http\Requests;

use App\Models\AnimalClassification;
use App\Models\AnimalType;
use App\Models\Beneficiary;
use App\Models\Purok;
use App\Services\AnimalTypeCatalog;
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
            // The species, as a name from the master list (the cascading
            // dropdown's value) OR its id. One of the two is required; the
            // server fills the other so the legacy display string and the FK
            // can never disagree.
            'animal_type' => ['required_without:animal_type_id', 'nullable', 'string', 'max:255'],
            'animal_type_id' => [
                'nullable',
                'integer',
                'exists:animal_types,id',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value === null || ! $this->filled('animal_type')) {
                        return;
                    }

                    $type = AnimalType::query()->find($value);
                    $named = app(AnimalTypeCatalog::class)->resolveType((string) $this->input('animal_type'));

                    if ($type && $named && $named->id !== $type->id) {
                        $fail('The animal type and the animal type id do not match.');
                    }
                },
            ],
            // Optional sex/age class within the chosen type. When given it
            // must actually belong to that type — the same consistency rule
            // the barangay → purok cascade enforces.
            'classification_id' => [
                'nullable',
                'integer',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value === null) {
                        return;
                    }

                    $catalog = app(AnimalTypeCatalog::class);
                    $typeId = $this->filled('animal_type_id')
                        ? (int) $this->input('animal_type_id')
                        : $catalog->resolveType((string) $this->input('animal_type'))?->id;

                    if ($typeId === null) {
                        $fail('Choose an animal type before choosing a classification.');

                        return;
                    }

                    $classification = AnimalClassification::query()->find($value);

                    if (! $classification || (int) $classification->animal_type_id !== $typeId) {
                        $fail('The selected classification does not belong to the chosen animal type.');
                    }
                },
            ],
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

        // Pair the value submitted by this request with the structured master
        // list (“Swine (Pig)” and its id, plus a nullable classification).
        // The submitted display string is kept exactly as typed when it still
        // resolves; only an id-only payload is given the canonical name.
        $validated = app(AnimalTypeCatalog::class)->applyPair($validated);

        return $validated;
    }
}
