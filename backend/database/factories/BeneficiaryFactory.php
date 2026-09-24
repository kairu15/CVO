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
     * Plausible coordinates per covered barangay (Bayawan City, Negros
     * Oriental), used for demo data and tests. Sourced from the official
     * config/barangays.php list via App\Support\Barangays (DB table first,
     * config fallback second) so the factory can never drift from the
     * seeded coverage. Jitter is applied per beneficiary so markers in the
     * same barangay do not stack perfectly on the map.
     */
    public static function BARANGAY_COORDS(): array
    {
        return Barangays::centers();
    }

    public function definition(): array
    {
        $address = fake()->randomElement(Barangays::all());
        [$lat, $lng] = self::BARANGAY_COORDS()[$address];

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

    /**
     * Attach the beneficiary to an existing farmer instead of making a new one.
     */
    public function forFarmer(User $farmer): static
    {
        return $this->state(fn () => [
            'farmer_id' => $farmer->id,
            'name_of_farmer' => $farmer->name,
        ]);
    }

    /**
     * Assign a technician at creation time.
     */
    public function assignedTo(User $technician): static
    {
        return $this->state(fn () => ['technician_id' => $technician->id]);
    }
}
