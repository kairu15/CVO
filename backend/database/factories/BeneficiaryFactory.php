<?php

namespace Database\Factories;

use App\Models\Beneficiary;
use App\Models\User;
use App\Support\Barangays;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Beneficiary>
 */
class BeneficiaryFactory extends Factory
{
    /** Livestock types dispersed by the program. */
    public const ANIMAL_TYPES = ['Carabao', 'Cattle', 'Goat', 'Swine', 'Boar'];

    /**
     * Plausible coordinates per barangay (Bayawan City, Negros Oriental), used
     * for demo data and tests. Jitter is applied per beneficiary so markers
     * in the same barangay do not stack perfectly on the map.
     */
    public const BARANGAY_COORDS = [
        'Ali-Nan-Ban' => [9.3701, 122.8053],
        'Banay Banay' => [9.5538, 122.8229],
        'Kalumboyan' => [9.5306, 122.8694],
        'Daw-Kal-Vil' => [9.5203, 122.8412],
        'Dawis' => [9.4712, 122.8319],
        'Cansumalig' => [9.3834, 122.8021],
        'Tayawan' => [9.3248, 122.7905],
    ];

    public function definition(): array
    {
        $address = fake()->randomElement(Barangays::all());
        [$lat, $lng] = self::BARANGAY_COORDS[$address];

        return [
            'farmer_id' => User::factory()->create(['role' => 'farmer'])->id,
            'name_of_farmer' => fake()->name(),
            'address' => $address,
            'animal_type' => fake()->randomElement(self::ANIMAL_TYPES),
            'sex' => fake()->randomElement(['M', 'F']),
            'latitude' => $lat + fake()->randomFloat(5, -0.004, 0.004),
            'longitude' => $lng + fake()->randomFloat(5, -0.004, 0.004),
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
