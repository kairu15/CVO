<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

class BeneficiaryResource extends JsonResource
{
    /**
     * Transform the resource into a JSON array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        // Contact is either kind of dated visit. The Field Visits log counts
        // a trip even when it produced no animal observation, so "overdue"
        // must not claim a household was never seen after a logged trip.
        $lastMonitoring = $this->monitoring_records_max_date_monitored
            ? Carbon::parse($this->monitoring_records_max_date_monitored)->toDateString()
            : null;
        $lastFieldVisit = $this->field_visits_max_visited_on
            ? Carbon::parse($this->field_visits_max_visited_on)->toDateString()
            : null;
        $lastContact = collect([$lastMonitoring, $lastFieldVisit])->filter()->max();

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
            // Structured pair from the master list. `animal_type_id` is null
            // only on a historical row the migration could not map; the
            // legacy string above still carries whatever the sheet said.
            'animal_type_id' => $this->animal_type_id,
            'classification_id' => $this->classification_id,
            'animal_classification' => $this->animalClassification?->name,
            // The specific type's display name when mapped, so a caller never
            // has to know whether the value came from the list or the sheet.
            'animal_type_name' => $this->animalType?->name ?? $this->animal_type,
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
            'field_visits_count' => $this->whenCounted('fieldVisits'),
            // Latest DATED monitoring row, from the directory's withMax
            // aggregate. Null for a household whose only row is the undated
            // enrolment row.
            'last_monitored_at' => $lastMonitoring,
            'last_field_visit_on' => $lastFieldVisit,
            // The most recent contact of EITHER kind — what the directory's
            // "Last visit" column and the overdue rule read.
            'last_contact_at' => $lastContact,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
