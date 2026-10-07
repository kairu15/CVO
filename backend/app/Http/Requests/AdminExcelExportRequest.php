<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET /api/v1/admin/monitoring-records/export — month filter (item 5).
 */
class AdminExcelExportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('export_monitoring_records');
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
            'month' => ['sometimes', 'nullable', 'date_format:Y-m'],

            // Optional animal type. When present, only that type's rows are
            // exported; when absent the export behaves exactly as before
            // (every type).
            'animal_type' => ['sometimes', 'nullable', 'string', 'max:100'],
        ];
    }
}
