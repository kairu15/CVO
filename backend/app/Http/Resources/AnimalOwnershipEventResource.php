<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AnimalOwnershipEventResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'animal_id' => $this->animal_id,
            'event_type' => $this->event_type,
            'type_label' => $this->typeLabel(),
            'from_beneficiary_id' => $this->from_beneficiary_id,
            'to_beneficiary_id' => $this->to_beneficiary_id,
            'event_date' => $this->event_date?->toDateString(),
            'date_is_estimated' => (bool) $this->date_is_estimated,
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            'location_source' => $this->location_source,
            'accuracy_m' => $this->accuracy_m,
            'remarks' => $this->remarks,
            'recorded_by' => $this->recorded_by,
            'status' => $this->status,
            'voided_by' => $this->voided_by,
            'voided_at' => $this->voided_at?->toIso8601String(),
            'void_reason' => $this->void_reason,

            'animal' => $this->whenLoaded('animal', fn () => new AnimalResource($this->animal)),
            // Null when the source is CVO / the recipient is a return to CVO.
            'from_beneficiary' => $this->from_beneficiary_id !== null && $this->relationLoaded('fromBeneficiary')
                ? new BeneficiaryResource($this->fromBeneficiary)
                : null,
            'to_beneficiary' => $this->to_beneficiary_id !== null && $this->relationLoaded('toBeneficiary')
                ? new BeneficiaryResource($this->toBeneficiary)
                : null,

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
