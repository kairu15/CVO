<?php

namespace App\Http\Resources;

use App\Models\HealthRecord;
use App\Support\SecureMedia;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class HealthRecordResource extends JsonResource
{
    /** Set only on the detail response, never on list or history rows. */
    public bool $includeHistory = false;

    /**
     * Transform the resource into a JSON array.
     *
     * The beneficiary identity fields ride along so the records table never
     * needs a second request, and the prescribing vet's name comes from the
     * eager-loaded `doctor` relation.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $data = [
            'id' => $this->id,
            'beneficiary_id' => $this->beneficiary_id,
            'doctor_id' => $this->doctor_id,
            'doctor' => new UserResource($this->whenLoaded('doctor')),

            // Identity fields from the beneficiary (read-only everywhere).
            'name_of_farmer' => $this->beneficiary->name_of_farmer,
            'address' => $this->beneficiary->address,
            'barangay' => $this->beneficiary->address,
            'rsbsa_number' => $this->beneficiary->rsbsa_number,
            'ear_tag_number' => $this->beneficiary->ear_tag_number,
            'animal_type' => $this->beneficiary->animal_type,
            'animal_quantity' => $this->animal_quantity ?? 1,
            'sex' => $this->beneficiary->sex,

            // Clinical fields.
            'date_recorded' => $this->date_recorded?->toDateString(),
            'diagnosis' => $this->diagnosis,
            'symptoms' => $this->symptoms,
            'treatment' => $this->treatment,
            'outcome' => $this->outcome,
            'remarks' => $this->remarks,

            // Derived follow-up state (see HealthRecord::followUpStatus).
            'follow_up_on' => $this->follow_up_on?->toDateString(),
            'follow_up_completed_at' => $this->follow_up_completed_at?->toIso8601String(),
            'follow_up_status' => $this->followUpStatus(),
            'has_photo' => $this->photo_path !== null,
            // Short-lived signed URL on the private disk. The path itself is
            // not exposed, and the signature was only issued after the
            // scoped record lookup succeeded.
            'photo_url' => $this->photo_path !== null
                ? SecureMedia::temporaryUrl(
                    $this->photo_path,
                    now()->addMinutes((int) config('security.signed_url_minutes', 30)),
                )
                : null,

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];

        // The detail drawer gets the beneficiary's chronological examinations
        // in the same request. List responses never carry this (the relation
        // is not loaded there), so table pages stay small.
        if ($this->includeHistory
            && $this->relationLoaded('beneficiary')
            && $this->beneficiary->relationLoaded('healthRecords')) {
            $data['history'] = HealthRecordResource::collection(
                $this->beneficiary->healthRecords->map(function (HealthRecord $record): HealthRecord {
                    $record->setRelation('beneficiary', $this->beneficiary);

                    return $record;
                }),
            );
        }

        return $data;
    }
}
