<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET /api/v1/beneficiaries — parameters for the role-scoped list.
 *
 * Read-only; only shapes the query, never mutates anything.
 *
 * `per_page` exists because the map, the dashboards and the picker dropdowns
 * have to see the SAME set of households the monitoring table reports on.
 * Without it the endpoint silently capped every caller at its 15-row default,
 * so the dispersal map drew only 15 of ~250 beneficiaries and read as "the
 * program has almost no geo-tagged farmers" while the monitoring table showed
 * hundreds of records.
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
            // Larger ceiling than the monitoring table (100): this list backs
            // whole-map / whole-directory views, not a paginated table, and the
            // city-wide dataset is a few hundred households.
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:500'],

            'page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
