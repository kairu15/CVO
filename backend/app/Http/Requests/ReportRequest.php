<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ReportRequest extends FormRequest
{
    /**
     * City-wide reporting is the administrator's overview by definition (the
     * admin blurb in roles.js promises it), and the endpoint is additionally
     * gated by view_reports at the route level — defense in depth, since a
     * FormRequest alone is easy to drop from a route during a refactor.
     */
    public function authorize(): bool
    {
        return $this->user()->hasPermission('view_reports');
    }

    public function rules(): array
    {
        return [
            // A specific barangay, or the whole city.
            'barangay' => ['sometimes', 'string', 'max:255'],

            // Narrow the dispersal aggregates to a recorded window. Null
            // means "the whole program so far".
            'from' => ['sometimes', 'nullable', 'date'],
            'to' => ['sometimes', 'nullable', 'date', 'after_or_equal:from'],

            // The master list's presentation category. It narrows the
            // households, deliveries and per-barangay rows together.
            'category' => ['sometimes', 'nullable', 'string', 'in:livestock,poultry,other'],
            'animal_type' => ['sometimes', 'nullable', 'string', 'max:255'],

            // Household lookup: a name, RSBSA number or ear tag. The same
            // term narrows the program, clinical and dispersal sections.
            'beneficiary' => ['sometimes', 'nullable', 'string', 'max:255'],

            // The handover type, which is what the screen calls dispersal
            // status. Returns stay outside the report's completed placements.
            'dispersal_type' => ['sometimes', 'nullable', Rule::in(['dispersal', 're_dispersal', 'pass_on'])],
        ];
    }
}
