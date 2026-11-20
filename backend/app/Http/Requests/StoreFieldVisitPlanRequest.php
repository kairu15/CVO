<?php

namespace App\Http\Requests;

use App\Models\FieldVisit;
use App\Models\FieldVisitPlan;
use App\Services\SettingsService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreFieldVisitPlanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', FieldVisit::class);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // A technician may only plan work for a household assigned to
            // them. The assignment check is in the query, not a client-side
            // dropdown, so a forged id cannot schedule someone else's farmer.
            'beneficiary_id' => [
                'required',
                'integer',
                Rule::exists('beneficiaries', 'id')->where(
                    fn ($query) => $query
                        ->where('technician_id', $this->user()->id)
                        ->whereNull('deleted_at'),
                ),
            ],
            'planned_for' => ['required', 'date', 'after_or_equal:today'],
            'purpose' => ['required', 'string', Rule::in(app(SettingsService::class)->fieldVisitPurposes())],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $duplicate = FieldVisitPlan::query()
                ->where('technician_id', $this->user()->id)
                ->where('beneficiary_id', $this->integer('beneficiary_id'))
                ->whereDate('planned_for', $this->date('planned_for'))
                ->open()
                ->exists();

            if ($duplicate) {
                $validator->errors()->add(
                    'beneficiary_id',
                    'You already have an open visit plan for this household on that date.',
                );
            }
        });
    }
}
