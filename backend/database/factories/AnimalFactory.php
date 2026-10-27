<?php

namespace Database\Factories;

use App\Models\Animal;
use App\Models\Beneficiary;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Animal>
 */
class AnimalFactory extends Factory
{
    protected $model = Animal::class;

    public function definition(): array
    {
        return [
            'ear_tag_number' => strtoupper(fake()->unique()->bothify('TAG-####-??')),
            // A legacy display string beside the (optional) master-list FK —
            // the same shape the beneficiaries table uses.
            'animal_type' => fake()->randomElement(['Carabao', 'Cattle', 'Goat', 'Swine (Pig)']),
            'animal_type_id' => null,
            'classification_id' => null,
            'sex' => fake()->randomElement(['M', 'F']),
            'parent_animal_id' => null,
            'current_owner_id' => null,
            'status' => Animal::STATUS_ACTIVE,
        ];
    }

    /** Held by a specific beneficiary. */
    public function ownedBy(Beneficiary $owner): static
    {
        return $this->state(fn (): array => ['current_owner_id' => $owner->id]);
    }

    /** An offspring of another animal. */
    public function offspringOf(Animal $parent): static
    {
        return $this->state(fn (): array => ['parent_animal_id' => $parent->id]);
    }

    public function returned(): static
    {
        return $this->state(fn (): array => [
            'status' => Animal::STATUS_RETURNED,
            'current_owner_id' => null,
        ]);
    }
}
