<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/admin/barangays — add a coverage area. Admin-only via both
 * route middleware and this request's authorize().
 *
 * Adding a barangay is safe (nothing references a name that does not exist
 * yet); renaming one is deliberately impossible — see BarangayController.
 */
class AdminBarangayStoreRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('manage_reference_data');
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
            'name' => ['required', 'string', 'min:2', 'max:255', Rule::unique('barangays', 'name')],
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.unique' => 'A barangay with this name is already covered.',
        ];
    }
}
