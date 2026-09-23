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
            'technician_id' => User::factory()->create(['role' => 'technician'])->id,
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
