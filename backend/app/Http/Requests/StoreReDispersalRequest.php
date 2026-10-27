<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidatesOwnershipChain;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Move the SAME animal to a new owner.
 *
 * `base_event_id` is required and must be the animal's latest active event: it
 * is the optimistic-concurrency token that makes a queued offline re-dispersal
 * safe — if the chain moved on, the server answers 409 rather than appending a
 * handover to a state the technician never saw.
 *
 * The recipient is NOT scoped to the technician here; the SOURCE (the animal's
 * current owner) is what an assigned technician may act on, and that is
 * enforced in AnimalDispersalService.
 */
class StoreReDispersalRequest extends FormRequest
{
    use ValidatesOwnershipChain;

    public function authorize(): bool
    {
        return $this->user()->hasPermission('manage_redispersal');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'to_beneficiary_id' => ['required', $this->beneficiaryExistsRule(false)],
            'base_event_id' => ['required', 'integer'],

            ...$this->locationAndDateRules(),
        ];
    }
}
