<?php

namespace App\Http\Resources;

use App\Services\FieldVisitService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FieldVisitResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        // The beneficiary's registered pin, so the UI can compare it with the
        // fix captured on site.
        $registeredLat = $this->beneficiary->latitude;
        $registeredLng = $this->beneficiary->longitude;

        return [
            'id' => $this->id,
            'beneficiary_id' => $this->beneficiary_id,
            'technician_id' => $this->technician_id,
            'technician' => new UserResource($this->whenLoaded('technician')),

            // Identity fields from the beneficiary (read-only everywhere).
            'name_of_farmer' => $this->beneficiary->name_of_farmer,
            'address' => $this->beneficiary->address,
            'animal_type' => $this->beneficiary->animal_type,
            'sex' => $this->beneficiary->sex,

            'visited_on' => $this->visited_on?->toDateString(),
            'purpose' => $this->purpose,
            'notes' => $this->notes,

            // The evidence of the trip.
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            'has_location' => $this->hasLocation(),
            'registered_latitude' => $registeredLat,
            'registered_longitude' => $registeredLng,
            'distance_from_registered_m' => FieldVisitService::distanceMeters(
                $this->latitude,
                $this->longitude,
                $registeredLat,
                $registeredLng,
            ),

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
