<?php

namespace App\Http\Requests;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use App\Support\Barangays;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDispersalEventRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', DispersalEvent::class);
    }

    /**
     * An initial dispersal needs no parent. A re-dispersal must name the
     * beneficiary whose animal produced the offspring, and either an existing
     * recipient or a new one to register inline.
     *
     * Beneficiary references are scoped by role — mirroring the query-level
     * scoping in BeneficiaryService — so a technician can never attach an
     * event to a beneficiary they are not assigned to, and a farmer never to
     * one they do not own.
     */
    /**
     * Store the canonical barangay spelling ("banaybanay" -> "Banay Banay"),
     * mirroring RegisterRequest and StoreBeneficiaryRequest.
     *
     * @return array<string, mixed>
     */
    public function validated($key = null, $default = null)
    {
        $validated = parent::validated($key, $default);

        if (array_key_exists('new_address', $validated) && is_string($validated['new_address'])) {
            $validated['new_address'] = Barangays::normalize($validated['new_address']);
        }

        return $validated;
    }

    public function rules(): array
    {
        $scopedBeneficiary = Rule::exists(Beneficiary::class, 'id')->where(
            fn ($query) => $this->applyRoleScope($query, $this->user()),
        );

        return [
            'beneficiary_id' => ['required', $scopedBeneficiary],
            'dispersal_type' => ['required', Rule::in(DispersalEvent::TYPES)],
            'parent_beneficiary_id' => [
                'nullable',
                $scopedBeneficiary,
                Rule::prohibitedIf($this->input('dispersal_type') === DispersalEvent::TYPE_INITIAL),
                Rule::requiredIf($this->input('dispersal_type') === DispersalEvent::TYPE_RE_DISPERSAL),
            ],
            'new_beneficiary_id' => [
                'nullable',
                Rule::exists(Beneficiary::class, 'id'),
                Rule::prohibitedIf($this->boolean('register_new')),
            ],
            'date_dispersed' => ['nullable', 'date'],
            'remarks' => ['nullable', 'string', 'max:2000'],

            // Inline registration of a brand new recipient household. The
            // recipient's location is a covered barangay name — the same rule
            // the registration and store requests enforce — and the pin is
            // resolved from that name server-side, never from typed numbers.
            'register_new' => ['sometimes', 'boolean'],
            'new_farmer_id' => [
                'nullable',
                Rule::exists('users', 'id')->where('role', 'farmer'),
            ],
            'new_name_of_farmer' => ['required_with:register_new', 'string', 'max:255'],
            'new_address' => [
                'required_with:register_new',
                'string',
                'max:255',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! Barangays::isCovered((string) $value)) {
                        $fail('Choose a barangay covered by the program: '.implode(', ', Barangays::all()).'.');
                    }
                },
            ],
            'new_animal_type' => ['required_with:register_new', 'string', 'max:255'],
            'new_sex' => ['required_with:register_new', Rule::in(['M', 'F'])],
            'new_latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'new_longitude' => ['nullable', 'numeric', 'between:-180,180'],
        ];
    }

    /**
     * The same role scoping BeneficiaryService applies to every list query,
     * reused here as an exists-rule constraint.
     */
    private function applyRoleScope($query, User $user): void
    {
        match ($user->role) {
            'admin', 'doctor' => null,
            'technician' => $query->where('technician_id', $user->id),
            default => $query->where('farmer_id', $user->id),
        };
    }
}
