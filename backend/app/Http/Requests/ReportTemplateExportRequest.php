<?php

namespace App\Http\Requests;

use App\Services\ReportTemplateService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/admin/report/template-export — the printable report.
 *
 * The template key is validated against the service's catalogue rather than
 * trusted as a filename: the request never names a path, only which of the
 * shipped templates to fill.
 *
 * Filters are the Reports screen's own set; all are optional, because an
 * unfiltered export is a valid "whole program" report.
 */
class ReportTemplateExportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('view_reports') ?? false;
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
            'template' => ['required', 'string', Rule::in(array_keys(ReportTemplateService::TEMPLATES))],
            // The editable report name: the title printed in the file and the
            // basis of the download filename (sanitized server-side).
            'name' => ['required', 'string', 'max:120'],
            'barangay' => ['sometimes', 'nullable', 'string', 'max:255'],
            'animal_type' => ['sometimes', 'nullable', 'string', 'max:255'],
            'month' => ['sometimes', 'nullable', 'date_format:Y-m'],
            'from' => ['sometimes', 'nullable', 'date'],
            'to' => ['sometimes', 'nullable', 'date', 'after_or_equal:from'],
        ];
    }
}
