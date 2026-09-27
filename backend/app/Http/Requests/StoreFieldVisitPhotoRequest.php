<?php

namespace App\Http\Requests;

use App\Models\FieldVisit;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/field-visits/{id}/photo — attach the geotagged photo (item 5).
 *
 * The image rules are the security boundary: `image` sniffs the REAL content
 * type with finfo (a renamed .php or .svg is rejected, not just filtered),
 * `mimes:` enforces the extension allow-list, `max:` the size. The structured
 * metadata fields are all tightly bounded primitives.
 */
class StoreFieldVisitPhotoRequest extends FormRequest
{
    /**
     * Same authorization the controller previously enforced inline:
     * the capturing technician (or an admin), via FieldVisitPolicy::update.
     */
    public function authorize(): bool
    {
        $visit = FieldVisit::find($this->route('id'));

        return $visit !== null && $this->user()->can('update', $visit);
    }

    /**
     * Authz failures must answer 403, not 422.
     */
    protected function failedAuthorization(): never
    {
        abort(403, 'This field visit is not yours to photograph.');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'image' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:8192'], // 8 MB cap

            // Wall-clock fields (device-local, as captured).
            'capture_date' => ['required', 'date'],
            'capture_time' => ['required', 'date_format:H:i:s'],
            'timezone_offset' => ['required', 'string', 'max:10'],
            'capture_year' => ['required', 'integer', 'digits:4'],
            'capture_month' => ['required', 'integer', 'between:1,12'],
            'capture_day' => ['required', 'integer', 'between:1,31'],
            'capture_hour' => ['required', 'integer', 'between:0,23'],
            'capture_minute' => ['required', 'integer', 'between:0,59'],
            'capture_second' => ['required', 'integer', 'between:0,59'],
            'capture_millisecond' => ['nullable', 'integer', 'between:0,999'],

            // The GPS fix.
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'accuracy_m' => ['nullable', 'numeric', 'min:0', 'max:100000'],
            'altitude_m' => ['nullable', 'numeric', 'min:-1000', 'max:10000'],
            'speed_kmh' => ['nullable', 'numeric', 'min:0', 'max:500'],
            'heading_deg' => ['nullable', 'integer', 'between:0,359'],
            'location_source' => ['nullable', Rule::in(['gps', 'network', 'wifi', 'none'])],
            'address' => ['nullable', 'string', 'max:500'],
        ];
    }
}
