<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET /api/v1/admin/beneficiaries — filter parameters for the admin
 * beneficiary directory (technician assignment screen). Admin-only via both
 * route middleware and this request's authorize().
 */
class AdminBeneficiariesRequest extends FormRequest
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
            'search' => ['sometimes', 'nullable', 'string', 'max:255'],

            // The directory groups every household by barangay for bulk
            // assignment, so it must be able to ask for the whole list —
            // capping it at the old fixed 15 rows made the page look like the
            // program only had a handful of beneficiaries.
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:500'],

            'page' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
