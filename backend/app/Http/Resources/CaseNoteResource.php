<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CaseNoteResource extends JsonResource
{
    /**
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

            'date_noted' => $this->date_noted?->toDateString(),
            'body' => $this->body,

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
