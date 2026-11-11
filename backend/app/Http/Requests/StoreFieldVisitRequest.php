<?php

namespace App\Http\Requests;

use App\Models\FieldVisit;
use App\Services\SettingsService;
use Illuminate\Validation\Validator;
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
            // Optional: which delivery this follow-up visit belongs to. It
            // must be one of THIS household's dispersals (checked below).
            'dispersal_event_id' => ['nullable', 'integer', Rule::exists('dispersal_events', 'id')],
            'visited_on' => ['required', 'date', 'before_or_equal:today'],
            'purpose' => ['required', 'string', Rule::in(app(SettingsService::class)->fieldVisitPurposes())],
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
            'notes' => ['nullable', 'string', 'max:2000'],

            // Field evidence is mandatory on new visits.
            'has_photo' => ['required', 'accepted'],
        ];
    }

    /**
     * A visit may only cite a dispersal that belongs to the household being
     * visited — otherwise the link would join two unrelated records.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty() || ! $this->filled('dispersal_event_id')) {
                return;
            }

            $belongs = \App\Models\DispersalEvent::query()
                ->whereKey($this->input('dispersal_event_id'))
                ->where('beneficiary_id', $this->input('beneficiary_id'))
                ->exists();

            if (! $belongs) {
                $validator->errors()->add(
                    'dispersal_event_id',
                    'Choose a dispersal that belongs to this household.',
                );
            }
        });
    }
}
