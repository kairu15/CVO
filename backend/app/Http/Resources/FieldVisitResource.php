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
            'has_photo' => $this->hasPhoto(),
            'photo' => $this->whenLoaded('photos', fn () => (
                ($latest = $this->photos->sortByDesc('id')->first())
                    ? new FieldVisitPhotoResource($latest)
                    : null
            )),
            'registered_latitude' => $registeredLat,
            'registered_longitude' => $registeredLng,
            'distance_from_registered_m' => FieldVisitService::distanceMeters(
                $this->latitude,
                $this->longitude,
                $registeredLat,
                $registeredLng,
            ),

            // Feature 1 — the SERVER's stored verdict over the photo/trip
            // fix and the registered pin. Computed from stored coordinates
            // on every save and sync replay (FieldVisitVerificationService),
            // never taken from the device. A review aid, not proof.
            'verification_status' => $this->verification_status,
            'distance_m' => $this->distance_m !== null ? (int) $this->distance_m : null,
            'gps_accuracy_m' => $this->gps_accuracy_m !== null ? (float) $this->gps_accuracy_m : null,
            'verification_note' => $this->verification_note,
            'verification_note_at' => $this->verification_note_at?->toIso8601String(),
            // Whether the household this visit belongs to still lacks a
            // registered pin — the condition for the admin's "use this
            // visit's location" action.
            'beneficiary_has_location' => $registeredLat !== null && $registeredLng !== null,

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
