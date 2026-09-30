<?php

namespace Database\Factories;

use App\Models\SymptomRule;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SymptomRule>
 */
class SymptomRuleFactory extends Factory
{
    public function definition(): array
    {
        return [
            'label' => fake()->words(2, true),
            'keywords' => [fake()->word()],
            'hint' => fake()->sentence(),
            'animal_type' => null,
            'is_active' => true,
            'sort_order' => 0,
        ];
    }

    /** Retire a rule without deleting it. */
    public function inactive(): static
    {
        return $this->state(fn () => ['is_active' => false]);
    }

    /** Scope a rule to one animal type. */
    public function forAnimalType(string $animalType): static
    {
        return $this->state(fn () => ['animal_type' => $animalType]);
    }
}
