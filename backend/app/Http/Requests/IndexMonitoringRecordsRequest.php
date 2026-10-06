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

            // Farmer-name search for the filter row. Applied server-side,
            // like `month`, so a match outside the current page is still
            // found (see MonitoringRecordService::listFor).
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],

            // Animal type (beneficiary column). Applied server-side and
            // COMBINED with `month` using AND, so "Boar" + "2026-12" returns
            // only boar records monitored that month.
            'animal_type' => ['sometimes', 'nullable', 'string', 'max:100'],

            // Row ordering: the default (by date) or grouped alphabetically by
            // animal type. Sorting happens in the DATABASE ORDER BY, never in
            // PHP/JS after the fetch.
            'sort' => ['sometimes', 'nullable', 'in:date,animal_type'],

            // Same policy as the other list endpoints (ActivityLogRequest):
            // an over-limit value is clamped to 50 by the controller
            // (App\Support\Pagination) instead of being rejected.
            'per_page' => ['sometimes', 'integer', 'min:1'],

            'page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
