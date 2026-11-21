<?php

namespace App\Http\Resources;

use App\Models\FieldVisit;
use App\Models\HealthRecord;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CaseNoteUpdateResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'case_note_id' => $this->case_note_id,
            'doctor_id' => $this->doctor_id,
            'doctor' => new UserResource($this->whenLoaded('doctor')),
            'happened_on' => $this->happened_on?->toDateString(),
            'observations' => $this->observations,
            'actions_taken' => $this->actions_taken,
            'recommendations' => $this->recommendations,
            'status' => $this->status,
            'follow_up_on' => $this->follow_up_on?->toDateString(),
            'health_record_id' => $this->health_record_id,
            'health_record' => $this->healthRecordSummary($this->whenLoaded('healthRecord')),
            'field_visit_id' => $this->field_visit_id,
            'field_visit' => $this->fieldVisitSummary($this->whenLoaded('fieldVisit')),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function healthRecordSummary(mixed $record): ?array
    {
        if (! $record instanceof HealthRecord) {
            return null;
        }

        return [
            'id' => $record->id,
            'date_recorded' => $record->date_recorded?->toDateString(),
            'diagnosis' => $record->diagnosis,
            'outcome' => $record->outcome,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function fieldVisitSummary(mixed $visit): ?array
    {
        if (! $visit instanceof FieldVisit) {
            return null;
        }

        return [
            'id' => $visit->id,
            'visited_on' => $visit->visited_on?->toDateString(),
            'purpose' => $visit->purpose,
            'notes' => $visit->notes,
        ];
    }
}
