<?php

namespace Database\Factories;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DispersalEvent>
 */
class DispersalEventFactory extends Factory
{
    public function definition(): array
    {
        return [
            'beneficiary_id' => Beneficiary::factory(),
            'parent_beneficiary_id' => null,
            'new_beneficiary_id' => null,
            'dispersal_type' => DispersalEvent::TYPE_INITIAL,
            'date_dispersed' => fake()->dateTimeBetween('-2 years', '-1 month'),
            'remarks' => fake()->optional()->sentence(),
        ];
    }

    /** An initial dispersal delivered to the given beneficiary. */
    public function initial(Beneficiary $beneficiary): static
    {
        return $this->state(fn () => [
            'beneficiary_id' => $beneficiary->id,
            'parent_beneficiary_id' => null,
            'dispersal_type' => DispersalEvent::TYPE_INITIAL,
        ]);
    }

    /**
     * A re-dispersal: the offspring came from the parent household's animal
     * and was received by the recipient household.
     */
    public function reDispersal(Beneficiary $recipient, Beneficiary $parent): static
    {
        return $this->state(fn () => [
            'beneficiary_id' => $recipient->id,
            'new_beneficiary_id' => $recipient->id,
            'parent_beneficiary_id' => $parent->id,
            'dispersal_type' => DispersalEvent::TYPE_RE_DISPERSAL,
        ]);
    }
}
