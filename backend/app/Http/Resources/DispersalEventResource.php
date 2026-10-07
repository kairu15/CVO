<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

class DispersalEventResource extends JsonResource
{
    /**
     * Transform the resource into a JSON array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'beneficiary_id' => $this->beneficiary_id,
            'parent_beneficiary_id' => $this->parent_beneficiary_id,
            'new_beneficiary_id' => $this->new_beneficiary_id,
            'dispersal_type' => $this->dispersal_type,
            'date_dispersed' => $this->date_dispersed?->toDateString(),
            'remarks' => $this->remarks,

            // E-signature of the dispersal agreement (item 7). The image is
            // served through a short-lived signed URL from the private disk,
            // never from the public webroot — same treatment as visit photos.
            'has_signature' => $this->signature_path !== null,
            'signature_url' => $this->signature_path
                ? \App\Support\SecureMedia::temporaryUrl(
                    $this->signature_path,
                    now()->addMinutes((int) config('security.signed_url_minutes', 30)),
                )
                : null,
            'signature_captured_by' => $this->signature_captured_by,
            'signature_captured_at' => $this->signature_captured_at?->toIso8601String(),

            'beneficiary' => new BeneficiaryResource($this->whenLoaded('beneficiary')),
            'parent_beneficiary' => new BeneficiaryResource($this->whenLoaded('parentBeneficiary')),
            'new_beneficiary' => new BeneficiaryResource($this->whenLoaded('newBeneficiary')),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
