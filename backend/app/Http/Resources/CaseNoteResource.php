<?php

namespace App\Http\Resources;

use App\Models\FieldVisit;
use App\Models\HealthRecord;
use App\Support\SecureMedia;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CaseNoteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $beneficiary = $this->beneficiary;

        $data = [
            'id' => $this->id,
            'reference_number' => $this->reference_number,
            'beneficiary_id' => $this->beneficiary_id,
            'doctor_id' => $this->doctor_id,
            'doctor' => new UserResource($this->whenLoaded('doctor')),

            // Household and animal identity, read live from the beneficiary.
            'name_of_farmer' => $beneficiary->name_of_farmer,
            'address' => $beneficiary->address,
            'barangay' => $beneficiary->address,
            'rsbsa_number' => $beneficiary->rsbsa_number,
            'ear_tag_number' => $beneficiary->ear_tag_number,
            'animal_type' => $beneficiary->animal_type,
            'sex' => $beneficiary->sex,

            'category' => $this->category,
            'status' => $this->status,
            'location' => $this->location,
            'date_reported' => $this->date_noted?->toDateString(),
            'date_noted' => $this->date_noted?->toDateString(),
            'body' => $this->body,
            'observations' => $this->body,
            'actions_taken' => $this->actions_taken,
            'recommendations' => $this->recommendations,

            'follow_up_on' => $this->follow_up_on?->toDateString(),
            'follow_up_completed_at' => $this->follow_up_completed_at?->toIso8601String(),
            'follow_up_status' => $this->followUpStatus(),
            'resolved_at' => $this->resolved_at?->toIso8601String(),

            'health_record_id' => $this->health_record_id,
            'health_record' => $this->healthRecordSummary($this->whenLoaded('healthRecord')),
            'field_visit_id' => $this->field_visit_id,
            'field_visit' => $this->fieldVisitSummary($this->whenLoaded('fieldVisit')),

            'has_photo' => $this->photo_path !== null,
            'photo_url' => $this->photo_path !== null
                ? SecureMedia::temporaryUrl(
                    $this->photo_path,
                    now()->addMinutes((int) config('security.signed_url_minutes', 30)),
                )
                : null,

            'updates_count' => $this->whenCounted('updates'),
            'updates' => $this->whenLoaded(
                'updates',
                fn () => CaseNoteUpdateResource::collection($this->updates),
            ),

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];

        // Detail responses add the household's existing clinical and visit
        // records so a case can link to them instead of copying their content.
        if ($this->relationLoaded('beneficiary')) {
            if ($beneficiary->relationLoaded('healthRecords')) {
                $data['related_health_records'] = $beneficiary->healthRecords
                    ->map(fn (HealthRecord $record): array => [
                        'id' => $record->id,
                        'date_recorded' => $record->date_recorded?->toDateString(),
                        'diagnosis' => $record->diagnosis,
                        'outcome' => $record->outcome,
                        'doctor' => $record->relationLoaded('doctor') ? $record->doctor?->name : null,
                    ])
                    ->values()
                    ->all();
            }

            if ($beneficiary->relationLoaded('fieldVisits')) {
                $data['related_field_visits'] = $beneficiary->fieldVisits
                    ->map(fn (FieldVisit $visit): array => [
                        'id' => $visit->id,
                        'visited_on' => $visit->visited_on?->toDateString(),
                        'purpose' => $visit->purpose,
                        'notes' => $visit->notes,
                        'technician' => $visit->relationLoaded('technician') ? $visit->technician?->name : null,
                    ])
                    ->values()
                    ->all();
            }
        }

        return $data;
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
