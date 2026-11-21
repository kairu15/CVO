<?php

namespace Database\Factories;

use App\Models\Beneficiary;
use App\Models\User;
use App\Models\Vaccination;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Vaccination>
 */
class VaccinationFactory extends Factory
{
    public function definition(): array
    {
        $administered = now()->subDays(fake()->numberBetween(1, 300));
        $protocol = 365;

        return [
            'beneficiary_id' => Beneficiary::factory(),
            'technician_id' => User::factory()->create(['role' => 'technician'])->id,
            'vaccine_name' => fake()->randomElement([
                'Anti-Rabies',
                'Hemorrhagic Septicemia',
                'Hog Cholera',
            ]),
            'administered_on' => $administered->toDateString(),
            'quantity' => 1,
            'batch_number' => fake()->optional(0.6)->bothify('LOT-####'),
            'protocol_days' => $protocol,
            'next_due_on' => $administered->copy()->addDays($protocol)->toDateString(),
            'notes' => fake()->optional(0.5)->sentence(),
        ];
    }

    public function forBeneficiary(Beneficiary $beneficiary): static
    {
        return $this->state(fn () => ['beneficiary_id' => $beneficiary->id]);
    }

    public function by(User $technician): static
    {
        return $this->state(fn () => ['technician_id' => $technician->id]);
    }
}
