<?php

namespace App\Http\Resources;

use App\Services\VaccinationScheduleService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of the vaccination schedule.
 *
 * The resource wraps a Beneficiary carrying an extra `last_vaccination_date`
 * attribute (added by the service's correlated subquery); the due date and
 * status are derived here so no caller has to recompute them.
 */
class VaccinationScheduleResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name_of_farmer' => $this->name_of_farmer,
            'address' => $this->address,
            'animal_type' => $this->animal_type,
            'sex' => $this->sex,
            'technician_id' => $this->technician_id,
            'technician' => new UserResource($this->whenLoaded('technician')),
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,

            // Derived — never stored.
            ...VaccinationScheduleService::scheduleFor($this->last_vaccination_date),
        ];
    }
}
