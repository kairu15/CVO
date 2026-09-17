<?php

namespace Database\Factories;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MonitoringRecord>
 */
class MonitoringRecordFactory extends Factory
{
    public function definition(): array
    {
        $monitored = fake()->dateTimeBetween('-6 months', 'now');

        return [
            'beneficiary_id' => Beneficiary::factory(),
            'technician_id' => User::factory()->create(['role' => 'technician'])->id,
            'date_monitored' => $monitored,
            'date_vits_supp' => fake()->optional(0.8)->dateTimeBetween($monitored, 'now'),
            'deworming_date' => fake()->optional(0.7)->dateTimeBetween($monitored, 'now'),
            'vaccination_date' => fake()->optional(0.6)->dateTimeBetween($monitored, 'now'),
            'date_breed' => fake()->optional(0.4)->dateTimeBetween($monitored, 'now'),
            'date_calved' => fake()->optional(0.3)->dateTimeBetween($monitored, 'now'),
            'bcs' => fake()->numberBetween(1, 5),
            'farmers_signature' => fake()->optional(0.9)->name(),
            'remarks' => fake()->randomElement(['Healthy', 'Underweight', 'Missing', 'Pregnant', null]),
        ];
    }

    /** Log the visit by an existing technician without creating new users. */
    public function by(User $technician): static
    {
        return $this->state(fn () => ['technician_id' => $technician->id]);
    }
}
