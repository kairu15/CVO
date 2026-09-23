<?php

namespace App\Http\Resources;

use App\Services\AnimalHealthService;
use App\Services\VaccinationScheduleService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of the animal health rollup.
 *
 * Wraps a Beneficiary carrying extra aggregates from AnimalHealthService; the
 * vaccination due date and the attention flag are derived here so no caller
 * recomputes them.
 */
class AnimalHealthResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $schedule = VaccinationScheduleService::scheduleFor($this->last_vaccination_date);
        $openCases = (int) $this->open_cases;
        $reasons = AnimalHealthService::attentionReasons($schedule, $openCases);

        return [
            'id' => $this->id,
            'name_of_farmer' => $this->name_of_farmer,
            'address' => $this->address,
            'animal_type' => $this->animal_type,
            'sex' => $this->sex,
            'technician_id' => $this->technician_id,
            'technician' => new UserResource($this->whenLoaded('technician')),

            'last_visit_date' => $this->last_visit_date,
            'latest_diagnosis' => $this->latest_diagnosis,
            'latest_outcome' => $this->latest_outcome,
            'open_cases' => $openCases,
            'notes_count' => (int) $this->notes_count,
            'last_note_date' => $this->last_note_date,

            // Derived vaccination state — identical to the schedule's.
            ...$schedule,

            'needs_attention' => $reasons !== [],
            'attention_reasons' => $reasons,
        ];
    }
}
