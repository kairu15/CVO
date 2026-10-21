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
            'name_of_farmer' => $this->name_of_farmer,
            // Farmer-level government ID (nullable), captured once here and
            // read-only everywhere it is displayed.
            'rsbsa_number' => $this->rsbsa_number,
            'address' => $this->address,
            'barangay_id' => $this->barangay_id,
            'purok_id' => $this->purok_id,
            'animal_type' => $this->animal_type,
            // Human-readable physical tag number (the tag card's QR is
            // derived from the id, not from this value).
            'ear_tag_number' => $this->ear_tag_number,
            'sex' => $this->sex,
            // Signed MOA for this dispersal: null = not on file, true = yes,
            // false = no. Flipped from the admin monitoring table.
            'moa_signed' => $this->moa_signed,
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            'location_source' => $this->location_source,
            'technician_id' => $this->technician_id,
            'technician' => new UserResource($this->whenLoaded('technician')),
            'monitoring_records_count' => $this->whenCounted('monitoringRecords'),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
