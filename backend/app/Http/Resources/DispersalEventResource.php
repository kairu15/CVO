<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DispersalEventResource extends JsonResource
{
    /**
     * Transform the resource into a JSON array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'beneficiary_id' => $this->beneficiary_id,
            'parent_beneficiary_id' => $this->parent_beneficiary_id,
            'new_beneficiary_id' => $this->new_beneficiary_id,
            'dispersal_type' => $this->dispersal_type,
            'date_dispersed' => $this->date_dispersed?->toDateString(),
            'remarks' => $this->remarks,
            'beneficiary' => new BeneficiaryResource($this->whenLoaded('beneficiary')),
            'parent_beneficiary' => new BeneficiaryResource($this->whenLoaded('parentBeneficiary')),
            'new_beneficiary' => new BeneficiaryResource($this->whenLoaded('newBeneficiary')),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
