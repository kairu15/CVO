<?php

namespace App\Http\Requests;

use App\Models\FieldVisit;
use App\Models\FieldVisitPlan;
use App\Services\SettingsService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateFieldVisitPlanRequest extends FormRequest
{
    public function authorize(): bool
    {
        $plan = $this->route('plan');

        return $plan instanceof FieldVisitPlan
            && $this->user()->role === 'technician'
            && $plan->technician_id === $this->user()->id
            && $this->user()->can('create', FieldVisit::class);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'status' => [
                'sometimes',
                Rule::in([
                    FieldVisitPlan::STATUS_PENDING,
                    FieldVisitPlan::STATUS_IN_PROGRESS,
                    FieldVisitPlan::STATUS_COMPLETED,
                ]),
            ],
            'planned_for' => ['sometimes', 'date', 'after_or_equal:today'],
            'purpose' => ['sometimes', 'string', Rule::in(app(SettingsService::class)->fieldVisitPurposes())],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'field_visit_id' => ['sometimes', 'nullable', 'integer'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $plan = $this->route('plan');
            $status = $this->input('status', $plan->status);

            if ($status !== FieldVisitPlan::STATUS_COMPLETED) {
                return;
            }

            $visitId = $this->input('field_visit_id', $plan->field_visit_id);

            if ($visitId === null || $visitId === '') {
                $validator->errors()->add(
                    'field_visit_id',
                    'Record the completed field visit before marking the plan complete.',
                );

                return;
            }

            $belongs = FieldVisit::query()
                ->whereKey($visitId)
                ->where('beneficiary_id', $plan->beneficiary_id)
                ->where('technician_id', $this->user()->id)
                ->whereNull('deleted_at')
                ->exists();

            if (! $belongs) {
                $validator->errors()->add(
                    'field_visit_id',
                    'That visit does not belong to this household and technician.',
                );
            }
        });
    }
}
