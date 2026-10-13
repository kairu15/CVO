<?php

namespace App\Http\Requests;

use App\Models\Beneficiary;
use App\Models\User;
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
     * Rules for the identity fields captured at farmer registration. These
     * four columns are the ones the monitoring table auto-fills forever, so
     * they are captured once and validated strictly here. The address is a
     * barangay name from the coverage list — the pin resolves from the name.
     *
     * `farmer_id` is only honoured for admin/technician requests (registering
     * on behalf of a farmer); farmers always own their own records.
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
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
        ];

        if (in_array($this->user()->role, ['admin', 'technician'], true)) {
            $rules['farmer_id'] = ['nullable', Rule::exists(User::class, 'id')->where('role', 'farmer')];
        }

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
            $validated['address'] = Barangays::normalize($validated['address']);
        }

        return $validated;
    }
}
