<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AnimalResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'ear_tag_number' => $this->ear_tag_number,
            'animal_type' => $this->animal_type,
            'animal_type_id' => $this->animal_type_id,
            'classification_id' => $this->classification_id,
            // The resolved master-list names, so a caller never has to know
            // whether the value came from the list or a legacy string.
            'animal_type_name' => $this->typeName(),
            'animal_classification' => $this->animalClassification?->name,
            'sex' => $this->sex,
            'status' => $this->status,
            'parent_animal_id' => $this->parent_animal_id,
            'current_owner_id' => $this->current_owner_id,
            'current_owner' => $this->whenLoaded(
                'currentOwner',
                fn () => new BeneficiaryResource($this->currentOwner),
            ),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
