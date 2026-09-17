<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BeneficiaryResource extends JsonResource
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
            'farmer_id' => $this->farmer_id,
            'name_of_farmer' => $this->name_of_farmer,
            'address' => $this->address,
            'animal_type' => $this->animal_type,
            'sex' => $this->sex,
            'technician_id' => $this->technician_id,
            'technician' => new UserResource($this->whenLoaded('technician')),
            'farmer' => new UserResource($this->whenLoaded('farmer')),
            'monitoring_records_count' => $this->whenCounted('monitoringRecords'),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
