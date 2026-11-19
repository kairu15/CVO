<?php

namespace App\Http\Requests;

use App\Models\ActivityLog;
use App\Models\User;
use App\Support\AuditTaxonomy;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/admin/activity-logs — filters for the audit log dashboard.
 *
 * Read-only (item 7); only shapes the query, never mutates anything. The
 * summary, list and CSV export all validate through here so one filter
 * cannot mean three different things.
 */
class ActivityLogRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null && $this->user()->hasPermission('view_activity_logs');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'action' => ['sometimes', 'nullable', 'string', Rule::in(ActivityLog::ACTIONS)],
            'actor_id' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'actor_role' => ['sometimes', 'nullable', 'string', Rule::in(User::ROLES)],
            // Entity type — the short class basename (`Beneficiary`).
            'target_type' => ['sometimes', 'nullable', 'string', 'max:64'],
            'module' => ['sometimes', 'nullable', 'string', Rule::in(array_keys(AuditTaxonomy::MODULES))],
            'status' => ['sometimes', 'nullable', 'string', Rule::in(array_column(AuditTaxonomy::statuses(), 'value'))],
            'ip_address' => ['sometimes', 'nullable', 'string', 'max:45'],
            'date_from' => ['sometimes', 'nullable', 'date'],
            'date_to' => ['sometimes', 'nullable', 'date', 'after_or_equal:date_from'],
            'search' => ['sometimes', 'nullable', 'string', 'max:255'],
            // Lightweight list shape; the detail endpoint carries the diff.
            'summary' => ['sometimes', 'boolean'],
            // Over-limit values are clamped to 50 by the controller
            // (App\Support\Pagination), matching every other list endpoint.
            'per_page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
