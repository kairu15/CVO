<?php

namespace Database\Factories;

use App\Models\Beneficiary;
use App\Models\HealthRecord;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<HealthRecord>
 */
class HealthRecordFactory extends Factory
{
    public function definition(): array
    {
        return [
            'beneficiary_id' => Beneficiary::factory(),
            'doctor_id' => User::factory()->create(['role' => 'doctor'])->id,
            'date_recorded' => fake()->dateTimeBetween('-6 months', 'now'),
            'diagnosis' => fake()->randomElement([
                'Foot and mouth disease (suspected)',
                'Mastitis',
                'Internal parasites',
                'Hoof rot',
                'Respiratory infection',
                'Malnutrition',
            ]),
            'treatment' => fake()->optional(0.85)->sentence(),
            'outcome' => fake()->optional(0.7)->randomElement(config('cvo.health_outcomes')),
            'remarks' => fake()->optional(0.5)->sentence(),
        ];
    }

    /** Author the record as an existing veterinarian. */
    public function by(User $doctor): static
    {
        return $this->state(fn () => ['doctor_id' => $doctor->id]);
    }

    /** Attach the record to an existing beneficiary. */
    public function forBeneficiary(Beneficiary $beneficiary): static
    {
        return $this->state(fn () => ['beneficiary_id' => $beneficiary->id]);
    }
}
