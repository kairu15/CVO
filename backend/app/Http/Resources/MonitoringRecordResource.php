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
            // Structured master-list pair: the species id / display name and
            // the selected classification, so the table can show and filter
            // both without a second request.
            'animal_type_id' => $this->beneficiary->animal_type_id,
            'animal_type_name' => $this->beneficiary->animalType?->name ?? $this->beneficiary->animal_type,
            'classification_id' => $this->beneficiary->classification_id,
            'animal_classification' => $this->beneficiary->animalClassification?->name,
            'sex' => $this->beneficiary->sex,

            // Registry / agreement fields, read from the beneficiary so the
            // monitoring table needs no second request. RSBSA # is the
            // farmer's national registry ID; MOA is the signed agreement for
            // this dispersal (null = not on file); Ear Tag # is the physical
            // tag number. All nullable — historical rows simply omit them.
            'rsbsa_number' => $this->beneficiary->rsbsa_number,
            'moa_signed' => $this->beneficiary->moa_signed,
            'ear_tag_number' => $this->beneficiary->ear_tag_number,

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
            // The SERVER's on-site verdict for that photo's visit, computed
            // from stored coordinates (Feature 1). Null when the household
            // has never had a geotagged visit.
            'visit_verification_status' => $this->whenLoaded(
                'beneficiary',
                fn () => $this->beneficiary->relationLoaded('latestFieldVisitPhoto')
                    ? $this->beneficiary->latestFieldVisitPhoto?->visit_verification_status
                    : null,
            ),

            // Visit fields.
            'date_monitored' => $this->date_monitored?->toDateString(),
            'date_vits_supp' => $this->date_vits_supp?->toDateString(),
            'deworming_date' => $this->deworming_date?->toDateString(),
            'vaccination_date' => $this->vaccination_date?->toDateString(),
            'date_breed' => $this->date_breed?->toDateString(),
            'date_calved' => $this->date_calved?->toDateString(),
            'bcs' => $this->bcs,
            // Legacy typed confirmation. Kept for historical rows; new visits
            // capture the farmer's actual signature below.
            'farmers_signature' => $this->farmers_signature,

            // Digital farmer signature. The image lives on the private
            // `secure` disk and is exposed only as a short-lived signed URL
            // to callers already authorized to view this record — never a
            // public path. `has_farmer_signature` lets the table render its
            // "no signature recorded" state without probing the URL.
            'has_farmer_signature' => $this->farmer_signature_path !== null,
            'farmer_signature_url' => $this->farmer_signature_path
                ? \App\Support\SecureMedia::temporaryUrl(
                    $this->farmer_signature_path,
                    now()->addMinutes((int) config('security.signed_url_minutes', 30)),
                )
                : null,
            'signature_mime_type' => $this->signature_mime_type,
            'farmer_signed_at' => $this->farmer_signed_at?->toIso8601String(),
            'signature_captured_by' => $this->signature_captured_by,
            'signature_captured_by_name' => $this->whenLoaded(
                'signatureCapturedBy',
                fn () => $this->signatureCapturedBy?->name,
            ),

            'remarks' => $this->remarks,

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
