<?php

namespace App\Http\Resources;

use App\Support\SecureMedia;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One completed vaccination in a household's history.
 */
class VaccinationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'beneficiary_id' => $this->beneficiary_id,
            'technician_id' => $this->technician_id,
            'technician' => new UserResource($this->whenLoaded('technician')),
            'name_of_farmer' => $this->beneficiary?->name_of_farmer,
            'address' => $this->beneficiary?->address,
            'animal_type' => $this->beneficiary?->animal_type,
            'vaccine_name' => $this->vaccine_name,
            'administered_on' => $this->administered_on?->toDateString(),
            'quantity' => $this->quantity,
            'batch_number' => $this->batch_number,
            'protocol_days' => $this->protocol_days,
            'next_due_on' => $this->next_due_on?->toDateString(),
            'notes' => $this->notes,
            'has_photo' => $this->photo_path !== null,
            'photo_url' => $this->photo_path !== null
                ? SecureMedia::temporaryUrl(
                    $this->photo_path,
                    now()->addMinutes((int) config('security.signed_url_minutes', 30)),
                )
                : null,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
