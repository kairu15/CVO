<?php

namespace App\Http\Resources;

use App\Services\AnimalHealthService;
use App\Services\VaccinationScheduleService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of the animal health monitoring rollup.
 *
 * `status` is the vaccination schedule status (kept for the schedule/detail
 * links); `health_status` is the monitoring status derived from examinations,
 * case observations, follow-ups and vaccination history.
 */
class AnimalHealthResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return self::rowData($this->resource);
    }

    /**
     * Shared by the list row and the detail drawer so both answer with the
     * same attention rule and the same vocabulary.
     *
     * @return array<string, mixed>
     */
    public static function rowData(object $row): array
    {
        $schedule = VaccinationScheduleService::scheduleFor($row->last_vaccination_date);
        $openCases = (int) ($row->open_concerns ?? 0);
        $overdueClinical = (int) ($row->overdue_clinical_follow_ups ?? 0);
        $overdueCase = (int) ($row->overdue_case_follow_ups ?? 0);
        $reasons = AnimalHealthService::attentionReasons(
            $schedule,
            $openCases,
            $overdueClinical,
            $overdueCase,
        );

        $healthStatus = $row->current_health_status
            ?? ($reasons !== [] ? 'attention' : 'unrecorded');

        return [
            'id' => $row->id,
            'beneficiary_id' => $row->id,
            'name_of_farmer' => $row->name_of_farmer,
            'rsbsa_number' => $row->rsbsa_number,
            'ear_tag_number' => $row->ear_tag_number,
            'address' => $row->address,
            'barangay' => $row->barangay?->name ?? $row->address,
            'purok' => $row->relationLoaded('purok') ? $row->purok?->name : null,
            'barangay_id' => $row->barangay_id,
            'animal_type' => $row->animal_type,
            'sex' => $row->sex,
            'quantity' => max(1, (int) ($row->quantity ?? 1)),
            'technician_id' => $row->technician_id,
            'technician' => $row->relationLoaded('technician') && $row->technician
                ? new UserResource($row->technician)
                : null,
            'latitude' => $row->latitude,
            'longitude' => $row->longitude,

            // Latest confirmed clinical examination. This is the only field
            // labelled as a diagnosis; case observations are separate.
            'last_examination_date' => $row->last_examination_date,
            'latest_health_id' => $row->latest_health_id,
            'latest_diagnosis' => $row->latest_diagnosis,
            'latest_outcome' => $row->latest_outcome,
            'latest_health_follow_up_on' => $row->latest_health_follow_up_on,
            'latest_health_follow_up_status' => self::followUpStatus(
                $row->latest_health_follow_up_on,
                $row->latest_health_follow_up_completed_at,
            ),
            'open_concerns' => $openCases,
            'open_cases' => $openCases,

            // Documented observations, not a diagnosis.
            'latest_case_status' => $row->latest_case_status,
            'latest_case_reference' => $row->latest_case_reference,
            'latest_case_date' => $row->latest_case_date,
            'latest_case_follow_up_on' => $row->latest_case_follow_up_on,

            'last_visit_date' => $row->last_monitoring_date,
            'last_monitoring_date' => $row->last_monitoring_date,
            'last_field_visit_date' => $row->last_field_visit_date,
            'notes_count' => (int) ($row->notes_count ?? 0),
            'last_note_date' => $row->last_note_date,

            'health_status' => $healthStatus,
            'needs_attention' => $reasons !== [],
            'attention_reasons' => $reasons,
            'overdue_clinical_follow_ups' => $overdueClinical,
            'overdue_case_follow_ups' => $overdueCase,

            // Vaccination state is derived exactly as the schedule derives it.
            ...$schedule,
        ];
    }

    /**
     * Derived follow-up state for the latest examination, matching the
     * Health Records module's rule.
     */
    private static function followUpStatus(?string $date, mixed $completedAt): ?string
    {
        if (! $date) {
            return null;
        }

        if ($completedAt) {
            return 'completed';
        }

        return $date < today()->toDateString() ? 'overdue' : 'upcoming';
    }
}
