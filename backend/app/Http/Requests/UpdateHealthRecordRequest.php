<?php

namespace App\Http\Requests;

use App\Models\HealthRecord;
use App\Services\SettingsService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateHealthRecordRequest extends FormRequest
{
    public function authorize(): bool
    {
        $record = HealthRecord::find($this->route('health_record'));

        return $record && $this->user()->can('update', $record);
    }

    /**
     * Patch semantics: every field is optional. `beneficiary_id` is
     * deliberately absent — a clinical record is about one animal, and moving
     * it would silently rewrite that animal's history.
     *
     * A follow-up may not predate the examination, whether the examination
     * date arrives in this patch or already belongs to the record.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $record = HealthRecord::find($this->route('health_record'));

            if (! $record) {
                return;
            }

            $date = $this->input('date_recorded', $record->date_recorded?->toDateString());
            $followUp = array_key_exists('follow_up_on', $this->all())
                ? $this->input('follow_up_on')
                : $record->follow_up_on?->toDateString();

            if ($date && $followUp && (string) $followUp < (string) $date) {
                $validator->errors()->add(
                    'follow_up_on',
                    'The follow-up cannot be before the examination date.',
                );
            }
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'animal_quantity' => ['sometimes', 'integer', 'min:1', 'max:1000'],
            'date_recorded' => ['sometimes', 'date', 'before_or_equal:today'],
            'diagnosis' => ['sometimes', 'string', 'max:255'],
            'symptoms' => ['nullable', 'string', 'max:2000'],
            'treatment' => ['nullable', 'string', 'max:2000'],
            'outcome' => ['nullable', 'string', Rule::in(app(SettingsService::class)->healthOutcomes())],
            'follow_up_on' => ['sometimes', 'nullable', 'date'],
            'follow_up_completed' => ['sometimes', 'boolean'],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
