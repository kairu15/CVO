<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

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

            // Household identity. These come from the already-loaded
            // beneficiary, so connecting a visit to its record costs no extra
            // query and needs no second request from the table.
            'name_of_farmer' => $this->beneficiary->name_of_farmer,
            'address' => $this->beneficiary->address,
            'barangay' => $this->beneficiary->address,
            'rsbsa_number' => $this->beneficiary->rsbsa_number,
            'ear_tag_number' => $this->beneficiary->ear_tag_number,
            'animal_type' => $this->beneficiary->animal_type,
            'sex' => $this->beneficiary->sex,
            'moa_signed' => $this->beneficiary->moa_signed,
            // Latest DATED monitoring record for this household, when the
            // list query loaded the aggregate (drawer context only).
            'last_monitored_on' => $this->beneficiary->monitoring_records_max_date_monitored
                ? Carbon::parse($this->beneficiary->monitoring_records_max_date_monitored)->toDateString()
                : null,

            'visited_on' => $this->visited_on?->toDateString(),
            'purpose' => $this->purpose,
            'notes' => $this->notes,

            // Which delivery this visit followed up on (nullable). Only
            // present when the relation was eager-loaded.
            'dispersal_event_id' => $this->dispersal_event_id,
            'dispersal' => $this->whenLoaded('dispersalEvent', fn () => $this->dispersalEvent
                ? [
                    'id' => $this->dispersalEvent->id,
                    'date_dispersed' => $this->dispersalEvent->date_dispersed?->toDateString(),
                    'dispersal_type' => $this->dispersalEvent->dispersal_type,
                    'has_signature' => $this->dispersalEvent->hasSignature(),
                ]
                : null),

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

            // Feature 1 — the SERVER's stored verdict over the photo/trip
            // fix and the registered pin. Computed from stored coordinates
            // on every save and sync replay (FieldVisitVerificationService),
            // never taken from the device. A review aid, not proof.
            'verification_status' => $this->verification_status,
            // The STORED distance. It is recomputed server-side on save; the
            // resource does not re-run haversine per row.
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
