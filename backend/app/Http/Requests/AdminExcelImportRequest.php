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
        return $this->user()?->role === 'admin';
    }

    protected function failedAuthorization(): never
    {
        abort(403, 'Administrator access required.');
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
