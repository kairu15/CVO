<?php

namespace App\Http\Requests;

use App\Models\FieldVisit;
use App\Services\SettingsService;
use Illuminate\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateFieldVisitRequest extends FormRequest
{
    public function authorize(): bool
    {
        $visit = FieldVisit::find($this->route('field_visit'));

        return $visit && $this->user()->can('update', $visit);
    }

    /**
     * Patch semantics. `beneficiary_id` and `technician_id` are absent: a visit
     * happened at one farm by one person, and reassigning either would falsify
     * the log rather than correct it.
     */
    public function rules(): array
    {
        return [
            // Which delivery this visit followed up on. Nullable so the link
            // can be cleared; must belong to the visited household.
            'dispersal_event_id' => ['sometimes', 'nullable', 'integer', Rule::exists('dispersal_events', 'id')],
            'visited_on' => ['sometimes', 'date', 'before_or_equal:today'],
            'purpose' => ['sometimes', 'string', Rule::in(app(SettingsService::class)->fieldVisitPurposes())],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty() || ! $this->filled('dispersal_event_id')) {
                return;
            }

            $visit = FieldVisit::find($this->route('field_visit'));

            $belongs = $visit && \App\Models\DispersalEvent::query()
                ->whereKey($this->input('dispersal_event_id'))
                ->where('beneficiary_id', $visit->beneficiary_id)
                ->exists();

            if (! $belongs) {
                $validator->errors()->add(
                    'dispersal_event_id',
                    'Choose a dispersal that belongs to this household.',
                );
            }
        });
    }
}
