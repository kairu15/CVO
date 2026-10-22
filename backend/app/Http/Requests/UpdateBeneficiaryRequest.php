<?php

namespace App\Http\Requests;

use App\Models\AnimalClassification;
use App\Models\Beneficiary;
use App\Services\AnimalTypeCatalog;
use App\Support\Barangays;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/beneficiaries/{id} — update a beneficiary (item 5).
 *
 * The technician_id rule differs by role: only an administrator may hand a
 * household to a technician, and only to an account that actually holds the
 * technician role. Everyone else gets a `prohibited` rule so a hand-crafted
 * payload cannot smuggle an assignment past the role check.
 */
class UpdateBeneficiaryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name_of_farmer' => ['sometimes', 'string', 'max:255'],
            'address' => [
                'sometimes',
                'string',
                'max:255',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! Barangays::isCovered((string) $value)) {
                        $fail('Choose a barangay covered by the program: '.implode(', ', Barangays::all()).'.');
                    }
                },
            ],
            // Species, by master-list name or id. `sometimes` because this is
            // a partial update: a request that only corrects the ear tag must
            // not be forced to resend the animal.
            'animal_type' => ['sometimes', 'nullable', 'string', 'max:255'],
            'animal_type_id' => ['sometimes', 'nullable', 'integer', 'exists:animal_types,id'],
            'classification_id' => [
                'sometimes',
                'nullable',
                'integer',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value === null) {
                        return;
                    }

                    $catalog = app(AnimalTypeCatalog::class);
                    $typeId = $this->filled('animal_type_id')
                        ? (int) $this->input('animal_type_id')
                        : ($catalog->resolveType((string) $this->input('animal_type'))?->id
                            ?? $this->currentBeneficiary()?->animal_type_id);

                    if ($typeId === null) {
                        $fail('Choose an animal type before choosing a classification.');

                        return;
                    }

                    $classification = AnimalClassification::query()->find($value);

                    if (! $classification || (int) $classification->animal_type_id !== (int) $typeId) {
                        $fail('The selected classification does not belong to the chosen animal type.');
                    }
                },
            ],
            // Registry ID and physical tag number. Loose on purpose (no single
            // RSBSA format; tags are office-issued) — see
            // StoreBeneficiaryRequest for the rationale.
            'rsbsa_number' => ['nullable', 'string', 'max:255'],
            'ear_tag_number' => ['nullable', 'string', 'max:255'],
            'sex' => ['sometimes', 'in:M,F'],
            // Same tri-state as enrolment: null clears the recorded status,
            // true/false records it. The monitoring table's inline toggle
            // writes the same column.
            'moa_signed' => ['nullable', 'boolean'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'technician_id' => $this->user()?->hasPermission('assign_technicians')
                ? ['nullable', 'integer', 'exists:users,id,role,technician']
                : ['prohibited'],
        ];
    }

    /**
     * Keep the master-list pair consistent on a partial update: resolve the
     * submitted type (by id or name), fill the other half, and drop a stale
     * classification when the type changes.
     *
     * @return array<string, mixed>
     */
    public function validated($key = null, $default = null)
    {
        $validated = parent::validated($key, $default);

        return app(AnimalTypeCatalog::class)->applyPair($validated, $this->currentBeneficiary());
    }

    /** The beneficiary being edited (the route carries an id, not a model). */
    private function currentBeneficiary(): ?Beneficiary
    {
        $id = $this->route('beneficiary');

        return $id instanceof Beneficiary ? $id : Beneficiary::query()->find($id);
    }

    /**
     * A blank RSBSA # / Ear Tag # clears the field (null) rather than storing
     * an empty string — same rule the create request applies.
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
}
