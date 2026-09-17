<?php

namespace Database\Factories;

use App\Models\Beneficiary;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Beneficiary>
 */
class BeneficiaryFactory extends Factory
{
    /** Barangays the CVO monitoring sheets cover. */
    public const BARANGAYS = [
        'Ali-Nan-Ban',
        'Banay Banay',
        'Kalumboyan',
        'Daw-Kal-Vil',
        'Dawis',
        'Cansumalig',
        'Tayawan',
    ];

    /** Livestock types dispersed by the program. */
    public const ANIMAL_TYPES = ['Carabao', 'Cattle', 'Goat', 'Swine', 'Boar'];

    public function definition(): array
    {
        return [
            'farmer_id' => User::factory()->create(['role' => 'farmer'])->id,
            'name_of_farmer' => fake()->name(),
            'address' => fake()->randomElement(self::BARANGAYS),
            'animal_type' => fake()->randomElement(self::ANIMAL_TYPES),
            'sex' => fake()->randomElement(['M', 'F']),
            'technician_id' => null,
        ];
    }

    /** Attach the beneficiary to an existing farmer instead of making a new one. */
    public function forFarmer(User $farmer): static
    {
        return $this->state(fn () => [
            'farmer_id' => $farmer->id,
            'name_of_farmer' => $farmer->name,
        ]);
    }

    /** Assign a technician at creation time. */
    public function assignedTo(User $technician): static
    {
        return $this->state(fn () => ['technician_id' => $technician->id]);
    }
}
