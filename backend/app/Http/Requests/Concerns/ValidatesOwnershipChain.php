<?php

namespace App\Http\Requests\Concerns;

use App\Models\AnimalOwnershipEvent;
use App\Models\Beneficiary;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;

/**
 * The validation fragments every ownership-chain action shares: the handover
 * location + date fields, and the beneficiary exists-rule with the correct
 * role scope.
 *
 * The scope on the TARGET differs by action, which is why it is a flag here:
 * a technician may only DISPERSE to a household assigned to them, but a
 * re-dispersal may hand an animal TO another technician's household — the
 * check there is on the SOURCE (the animal's current owner), and it lives in
 * AnimalDispersalService, not in an exists rule.
 */
trait ValidatesOwnershipChain
{
    /**
     * The event date and handover location. Every field is optional: the
     * server falls back to "today" and to the new owner's geotag (then the
     * barangay centre) so a field record can be captured with one tap.
     *
     * @return array<string, mixed>
     */
    protected function locationAndDateRules(): array
    {
        return [
            'event_date' => ['nullable', 'date'],
            // True only for a backfilled row whose date was inferred.
            'date_is_estimated' => ['sometimes', 'boolean'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            // Longitude without latitude (or vice versa) is a half-pin, so the
            // second one is required once the first arrives.
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
            'location_source' => ['nullable', Rule::in(AnimalOwnershipEvent::SOURCES)],
            'accuracy_m' => ['nullable', 'numeric', 'min:0', 'max:1000000'],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ];
    }

    /**
     * The recipient must be a live beneficiary — soft-deleted rows are
     * excluded by the default scope, which is what makes "inactive or
     * soft-deleted" a single rule (a beneficiary has no separate active flag).
     */
    protected function beneficiaryExistsRule(bool $scopeToTechnician): Exists
    {
        $user = $this->user();

        return Rule::exists(Beneficiary::class, 'id')
            ->where(function ($query) use ($scopeToTechnician, $user): void {
                if ($scopeToTechnician && $user?->role === 'technician') {
                    $query->where('technician_id', $user->id);
                }
            });
    }
}
