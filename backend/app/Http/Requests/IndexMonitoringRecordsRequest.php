<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET /api/v1/monitoring-records — filters for the monitoring table.
 *
 * Read-only; only shapes the query, never mutates anything. The month
 * filter is a backend query parameter on purpose: filtering client-side
 * after a paginated fetch is how a month tab ends up showing a slice of
 * a month instead of the whole month.
 */
class IndexMonitoringRecordsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // "YYYY-MM" — bucketed on date_monitored (the report's own
            // organizing field), never on created_at.
            'month' => ['sometimes', 'nullable', 'date_format:Y-m'],

            // Same bounds as the other list endpoints (ActivityLogRequest).
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],

            'page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
