<?php

namespace App\Http\Requests;

use App\Models\FieldVisit;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreFieldVisitRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', FieldVisit::class);
    }

    /**
     * The visiting technician is never accepted from the client — it is the
     * authenticated session.
     *
     * Coordinates are optional everywhere: a GPS fix is not always available,
     * and a visit without one is still a real visit. They are validated as a
     * pair so a half-captured fix cannot be stored.
     *
     * A geotagged PHOTO is required for every NEW visit (per-product decision,
     * 2026-09): field evidence is the point of the module. The photo itself
     * is attached right after the visit is created (POST /field-visits/{id}/
     * photo), so creation only asserts the client HAS one to upload.
     */
    public function rules(): array
    {
        return [
            'beneficiary_id' => ['required', Rule::exists('beneficiaries', 'id')],
            'visited_on' => ['required', 'date', 'before_or_equal:today'],
            'purpose' => ['required', 'string', Rule::in(config('cvo.field_visit_purposes'))],
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
            'notes' => ['nullable', 'string', 'max:2000'],

            // Field evidence is mandatory on new visits.
            'has_photo' => ['required', 'accepted'],
        ];
    }
}
