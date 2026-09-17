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
