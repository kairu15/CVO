<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class HealthRecordResource extends JsonResource
{
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
        return [
            'id' => $this->id,
            'beneficiary_id' => $this->beneficiary_id,
            'doctor_id' => $this->doctor_id,
            'doctor' => new UserResource($this->whenLoaded('doctor')),

            // Identity fields from the beneficiary (read-only everywhere).
            'name_of_farmer' => $this->beneficiary->name_of_farmer,
            'address' => $this->beneficiary->address,
            'animal_type' => $this->beneficiary->animal_type,
            'sex' => $this->beneficiary->sex,

            // Clinical fields.
            'date_recorded' => $this->date_recorded?->toDateString(),
            'diagnosis' => $this->diagnosis,
            'treatment' => $this->treatment,
            'outcome' => $this->outcome,
            'remarks' => $this->remarks,

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
