<?php

namespace App\Http\Resources;

use App\Models\CaseNote;
use App\Models\FieldVisit;
use App\Models\HealthRecord;
use App\Models\MonitoringRecord;
use App\Models\Vaccination;
use App\Services\SettingsService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One animal's monitoring drawer: identity, the existing clinical and
 * vaccination history, case observations, visits, and the derived attention
 * worklist. Records are read from their owning modules, never copied.
 */
class AnimalHealthDetailResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $healthRecords = $this->healthRecords ?? collect();
        $caseNotes = $this->caseNotes ?? collect();
        $openOutcomes = app(SettingsService::class)->openHealthOutcomes();

        return [
            ...AnimalHealthResource::rowData($this->resource),

            'health_records' => $healthRecords
                ->map(fn (HealthRecord $record): array => $this->healthRecordData($record))
                ->values()
                ->all(),

            // These are documented observations from Case Notes. They are
            // never labelled as a diagnosis, even when a note mentions one.
            'case_notes' => $caseNotes
                ->map(fn (CaseNote $note): array => $this->caseNoteData($note))
                ->values()
                ->all(),

            'vaccination_history' => $this->vaccinations
                ->map(fn (Vaccination $vaccination): array => $this->vaccinationData($vaccination))
                ->values()
                ->all(),

            'monitoring_records' => $this->monitoringRecords
                ->map(fn (MonitoringRecord $record): array => [
                    'id' => $record->id,
                    'date_monitored' => $record->date_monitored?->toDateString(),
                    'vaccination_date' => $record->vaccination_date?->toDateString(),
                    'deworming_date' => $record->deworming_date?->toDateString(),
                    'date_vits_supp' => $record->date_vits_supp?->toDateString(),
                    'bcs' => $record->bcs,
                    'remarks' => $record->remarks,
                    'technician' => $record->technician?->name,
                ])
                ->values()
                ->all(),

            'field_visits' => $this->fieldVisits
                ->map(fn (FieldVisit $visit): array => [
                    'id' => $visit->id,
                    'visited_on' => $visit->visited_on?->toDateString(),
                    'purpose' => $visit->purpose,
                    'notes' => $visit->notes,
                    'latitude' => $visit->latitude,
                    'longitude' => $visit->longitude,
                    'technician' => $visit->technician?->name,
                ])
                ->values()
                ->all(),

            'related_concerns' => [
                ...$healthRecords
                    ->filter(fn (HealthRecord $record): bool => $record->outcome === null
                        || in_array($record->outcome, $openOutcomes, true))
                    ->map(fn (HealthRecord $record): array => [
                        'type' => 'health_record',
                        'id' => $record->id,
                        'date' => $record->date_recorded?->toDateString(),
                        'title' => $record->diagnosis,
                        'outcome' => $record->outcome,
                        'follow_up_on' => $record->follow_up_on?->toDateString(),
                        'follow_up_status' => $record->followUpStatus(),
                        'is_diagnosis' => true,
                    ])
                    ->values()
                    ->all(),
                ...$caseNotes
                    ->filter(fn (CaseNote $note): bool => $note->status !== CaseNote::STATUS_RESOLVED)
                    ->map(fn (CaseNote $note): array => [
                        'type' => 'case_observation',
                        'id' => $note->id,
                        'date' => $note->date_noted?->toDateString(),
                        'title' => 'Case observation',
                        'outcome' => null,
                        'follow_up_on' => $note->follow_up_on?->toDateString(),
                        'follow_up_status' => $note->followUpStatus(),
                        'is_diagnosis' => false,
                    ])
                    ->values()
                    ->all(),
            ],

            'latest_examination' => $healthRecords->first()
                ? $this->healthRecordData($healthRecords->first())
                : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function healthRecordData(HealthRecord $record): array
    {
        $record->setRelation('beneficiary', $this->resource);

        return (new HealthRecordResource($record))->resolve();
    }

    /**
     * @return array<string, mixed>
     */
    private function vaccinationData(Vaccination $vaccination): array
    {
        $vaccination->setRelation('beneficiary', $this->resource);

        return (new VaccinationResource($vaccination))->resolve();
    }

    /**
     * @return array<string, mixed>
     */
    private function caseNoteData(CaseNote $note): array
    {
        return [
            'id' => $note->id,
            'reference_number' => $note->reference_number,
            'date_reported' => $note->date_noted?->toDateString(),
            'category' => $note->category,
            'status' => $note->status,
            'body' => $note->body,
            'actions_taken' => $note->actions_taken,
            'recommendations' => $note->recommendations,
            'follow_up_on' => $note->follow_up_on?->toDateString(),
            'follow_up_completed_at' => $note->follow_up_completed_at?->toIso8601String(),
            'follow_up_status' => $note->followUpStatus(),
            'resolved_at' => $note->resolved_at?->toIso8601String(),
            'doctor' => $note->doctor?->name,
            'updates' => $note->updates
                ->map(fn ($update): array => [
                    'id' => $update->id,
                    'happened_on' => $update->happened_on?->toDateString(),
                    'observations' => $update->observations,
                    'actions_taken' => $update->actions_taken,
                    'recommendations' => $update->recommendations,
                    'status' => $update->status,
                    'follow_up_on' => $update->follow_up_on?->toDateString(),
                    'doctor' => $update->doctor?->name,
                ])
                ->values()
                ->all(),
        ];
    }
}
