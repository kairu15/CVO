<?php

namespace App\Http\Requests;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateDispersalEventRequest extends FormRequest
{
    public function authorize(): bool
    {
        $event = DispersalEvent::find($this->route('dispersal_event'));

        return $event !== null && $this->user()->can('update', $event);
    }

    /**
     * The dispersal type the PATCH will leave the event with: the incoming
     * value when present, otherwise the stored one. The parent rules depend on
     * it, and a partial update that does not resend `dispersal_type` must still
     * be validated against the type the event will actually have.
     */
    private function effectiveType(): ?string
    {
        return $this->input('dispersal_type')
            ?? DispersalEvent::find($this->route('dispersal_event'))?->dispersal_type;
    }

    /**
     * An initial dispersal can carry no parent. When the type is being switched
     * back to `initial`, treat any resent parent id as null rather than fail
     * with a confusing "parent prohibited" error — the service clears it.
     */
    protected function prepareForValidation(): void
    {
        if ($this->input('dispersal_type') === DispersalEvent::TYPE_INITIAL) {
            $this->merge(['parent_beneficiary_id' => null]);
        }
    }

    /**
     * Patch semantics: only the descriptive fields of a recorded dispersal are
     * correctable — its type, source household, date and remarks. The recipient
     * (`beneficiary_id`), the inline-registered household (`new_beneficiary_id`)
     * and the captured signature are audit anchors and are never accepted from
     * the client (the signature is additionally frozen by the model itself).
     */
    public function rules(): array
    {
        $scopedBeneficiary = Rule::exists(Beneficiary::class, 'id')->where(
            fn ($query) => $this->applyRoleScope($query, $this->user()),
        );

        $type = $this->effectiveType();

        return [
            'dispersal_type' => ['sometimes', Rule::in(DispersalEvent::TYPES)],
            // Deliberately NOT `sometimes`: `requiredIf` must still fire when
            // the field is absent and the event is (or is becoming) a
            // re-dispersal — `sometimes` would skip every rule, including the
            // requirement.
            'parent_beneficiary_id' => [
                'nullable',
                $scopedBeneficiary,
                Rule::prohibitedIf($type === DispersalEvent::TYPE_INITIAL),
                Rule::requiredIf($type === DispersalEvent::TYPE_RE_DISPERSAL),
            ],
            'date_dispersed' => ['sometimes', 'nullable', 'date'],
            'remarks' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }

    /**
     * The same role scoping BeneficiaryService applies to every list query,
     * reused here as an exists-rule constraint, mirroring StoreDispersalEventRequest.
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
