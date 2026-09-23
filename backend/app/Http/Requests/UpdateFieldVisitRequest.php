<?php

namespace App\Http\Requests;

use App\Models\FieldVisit;
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
            'visited_on' => ['sometimes', 'date', 'before_or_equal:today'],
            'purpose' => ['sometimes', 'string', Rule::in(config('cvo.field_visit_purposes'))],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
