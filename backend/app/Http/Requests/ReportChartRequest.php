<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET /api/v1/admin/report/charts/* — the chart endpoints' shared filter set.
 *
 * Filters mirror the ones the Screens already speak: `barangay` (the covered
 * list), `animal_type` (the data-derived types), `month` ("YYYY-MM", bucketed
 * on date_monitored like Monitoring Records) and `from`/`to` for an explicit
 * range. A chart applies whichever of these are meaningful to it.
 *
 * Report charts are part of the report module — the view_reports capability
 * gates them (route middleware + this authorize).
 */
class ReportChartRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('view_reports');
    }

    protected function failedAuthorization(): never
    {
        abort(403, 'You do not have permission to perform this action.');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'barangay' => ['sometimes', 'nullable', 'string', 'max:255'],
            'animal_type' => ['sometimes', 'nullable', 'string', 'max:255'],
            'month' => ['sometimes', 'nullable', 'date_format:Y-m'],
            'from' => ['sometimes', 'nullable', 'date'],
            'to' => ['sometimes', 'nullable', 'date', 'after_or_equal:from'],
        ];
    }
}
