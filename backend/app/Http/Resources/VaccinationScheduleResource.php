<?php

namespace App\Http\Resources;

use App\Services\VaccinationScheduleService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One household's current vaccination schedule row.
 */
class VaccinationScheduleResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $latest = $this->latestVaccination;
        $schedule = VaccinationScheduleService::scheduleFor(
            $this->last_vaccination_date,
            $this->scheduled_next_due_on,
            $latest?->protocol_days,
            $this->latest_vaccination_next_due_on,
        );

        return [
            'id' => $this->id,
            'beneficiary_id' => $this->id,
            'name_of_farmer' => $this->name_of_farmer,
            'rsbsa_number' => $this->rsbsa_number,
            'ear_tag_number' => $this->ear_tag_number,
            'address' => $this->address,
            'barangay' => $this->address,
            'animal_type' => $this->animal_type,
            'sex' => $this->sex,
            'technician_id' => $this->technician_id,
            'technician' => new UserResource($this->whenLoaded('technician')),
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,

            // Latest completed dose, if the new history table has one.
            'latest_vaccination_id' => $latest?->id,
            'vaccine_name' => $latest?->vaccine_name,
            'batch_number' => $latest?->batch_number,
            'quantity' => $latest?->quantity ?? 1,
            'protocol_days' => $latest?->protocol_days,
            'history_count' => (int) ($this->vaccinations_count ?? 0),

            'has_override' => $this->scheduled_next_due_on !== null,
            'last_vaccination_date' => $schedule['last_vaccination_date'],
            'next_due_date' => $schedule['next_due_date'],
            'days_until_due' => $schedule['days_until_due'],
            'status' => $schedule['status'],
        ];
    }
}
