<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET /api/v1/beneficiaries — parameters for the role-scoped list.
 *
 * Read-only; only shapes the query, never mutates anything.
 *
 * `per_page` exists so a caller can ask for a page size other than the
 * default; the value is clamped to App\Support\Pagination::MAX_PER_PAGE (50)
 * by the controller, so this endpoint can never return more than 50 rows per
 * request. `page` walks the pages of that bounded size.
 */
class IndexBeneficiariesRequest extends FormRequest
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
            // No upper-bound rule here: an over-limit value is clamped to 50
            // by the controller (see App\Support\Pagination) rather than
            // rejected, so older callers keep working.
            'per_page' => ['sometimes', 'integer', 'min:1'],

            'page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
