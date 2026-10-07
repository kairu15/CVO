<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/admin/monitoring-records/import — the monthly monitoring
 * workbook upload (item 5). Only spreadsheet/CSV content types pass: the
 * `mimes` list matches real sniffed types for xlsx and csv.
 */
class AdminExcelImportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('import_monitoring_records');
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
            'file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:20480'],
        ];
    }
}
