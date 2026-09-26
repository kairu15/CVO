<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MonitoringRecordResource extends JsonResource
{
    /**
     * Transform the resource into a JSON array.
     *
     * The beneficiary identity fields ride along on every record so the
     * monitoring table never needs a second request and the technician is
     * never tempted to edit them — there is simply nothing to edit.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
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

            // The technician currently ASSIGNED to this beneficiary (admin's
            // assignment feature) — distinct from `technician`, which is who
            // happened to log this record. Null renders as "Unassigned".
            'assigned_technician' => new UserResource(
                $this->whenLoaded(
                    'beneficiary',
                    fn () => $this->beneficiary->relationLoaded('technician')
                        ? $this->beneficiary->technician
                        : null,
                ),
            ),

            // The beneficiary's most recent field-visit photo, ranked in SQL
            // by the service (capture date, then time, id as tie-break). The
            // composited image already carries the timestamp/geotag panel, so
            // the lightbox renders the image; the structured fields below are
            // the machine-readable truth for captions and reporting.
            'latest_field_visit_photo' => $this->whenLoaded(
                'beneficiary',
                fn () => $this->beneficiary->relationLoaded('latestFieldVisitPhoto')
                    && $this->beneficiary->latestFieldVisitPhoto !== null
                    ? new FieldVisitPhotoResource($this->beneficiary->latestFieldVisitPhoto)
                    : null,
            ),
            'has_photo' => $this->whenLoaded(
                'beneficiary',
                fn () => $this->beneficiary->relationLoaded('latestFieldVisitPhoto')
                    && $this->beneficiary->latestFieldVisitPhoto !== null,
            ),

            // Visit fields.
            'date_monitored' => $this->date_monitored?->toDateString(),
            'date_vits_supp' => $this->date_vits_supp?->toDateString(),
            'deworming_date' => $this->deworming_date?->toDateString(),
            'vaccination_date' => $this->vaccination_date?->toDateString(),
            'date_breed' => $this->date_breed?->toDateString(),
            'date_calved' => $this->date_calved?->toDateString(),
            'bcs' => $this->bcs,
            'farmers_signature' => $this->farmers_signature,
            'remarks' => $this->remarks,

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
