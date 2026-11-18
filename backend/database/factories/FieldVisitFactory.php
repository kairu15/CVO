<?php

namespace Database\Factories;

use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<FieldVisit>
 */
class FieldVisitFactory extends Factory
{
    public function definition(): array
    {
        return [
            'beneficiary_id' => Beneficiary::factory(),
            // Return the factory, not an eagerly-created model: a nested
            // factory is only resolved when the attribute is not overridden,
            // so `->by($technician)` no longer leaves a stray technician
            // account behind on every factory call.
            'technician_id' => User::factory()->state(['role' => 'technician']),
            'visited_on' => fake()->dateTimeBetween('-6 months', 'now'),
            'purpose' => fake()->randomElement(config('cvo.field_visit_purposes')),
            // A fix is not always captured, so leave roughly one in five without.
            'latitude' => fake()->optional(0.8)->latitude(),
            'longitude' => fake()->optional(0.8)->longitude(),
            'notes' => fake()->optional(0.7)->sentence(),
        ];
    }

    /** Log the visit as an existing technician. */
    public function by(User $technician): static
    {
        return $this->state(fn () => ['technician_id' => $technician->id]);
    }

    /** Attach the visit to an existing beneficiary. */
    public function forBeneficiary(Beneficiary $beneficiary): static
    {
        return $this->state(fn () => ['beneficiary_id' => $beneficiary->id]);
    }

    /** No GPS fix was captured. */
    public function withoutLocation(): static
    {
        return $this->state(fn () => ['latitude' => null, 'longitude' => null]);
    }
}
