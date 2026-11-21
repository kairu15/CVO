<?php

namespace App\Http\Requests;

use App\Models\CaseNote;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreCaseNoteUpdateRequest extends FormRequest
{
    public function authorize(): bool
    {
        $note = CaseNote::find($this->route('id'));

        return $note !== null
            && $this->user()->can('view', $note)
            && $this->user()->can('create', CaseNote::class);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'happened_on' => ['required', 'date', 'before_or_equal:today'],
            'observations' => ['nullable', 'string', 'max:5000'],
            'actions_taken' => ['nullable', 'string', 'max:5000'],
            'recommendations' => ['nullable', 'string', 'max:5000'],
            'status' => ['nullable', Rule::in(CaseNote::STATUSES)],
            'follow_up_on' => ['nullable', 'date'],
            'follow_up_completed' => ['sometimes', 'boolean'],
            'health_record_id' => ['nullable', 'integer', Rule::exists('health_records', 'id')],
            'field_visit_id' => ['nullable', 'integer', Rule::exists('field_visits', 'id')],
        ];
    }

    /**
     * A timeline entry must actually add something. A date by itself is not an
     * update and would create an empty row in the case history.
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $meaningful = array_filter(
                    ['observations', 'actions_taken', 'recommendations'],
                    fn (string $key): bool => trim((string) $this->input($key, '')) !== '',
                );

                if ($meaningful === []
                    && ! $this->filled('status')
                    && ! $this->filled('follow_up_on')
                    && ! $this->has('follow_up_completed')) {
                    $validator->errors()->add(
                        'observations',
                        'Add an observation, action, recommendation, status or follow-up change.',
                    );
                }
            },
        ];
    }
}
