<?php

namespace Database\Factories;

use App\Models\Animal;
use App\Models\AnimalOwnershipEvent;
use App\Models\Beneficiary;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AnimalOwnershipEvent>
 */
class AnimalOwnershipEventFactory extends Factory
{
    protected $model = AnimalOwnershipEvent::class;

    public function definition(): array
    {
        return [
            'animal_id' => Animal::factory(),
            'event_type' => AnimalOwnershipEvent::TYPE_DISPERSAL,
            'from_beneficiary_id' => null,
            'to_beneficiary_id' => Beneficiary::factory(),
            'event_date' => now()->toDateString(),
            'date_is_estimated' => false,
            'location_source' => 'manual_pin',
            'latitude' => fake()->latitude(9.3, 9.7),
            'longitude' => fake()->longitude(122.6, 123.1),
            'status' => AnimalOwnershipEvent::STATUS_ACTIVE,
        ];
    }

    public function forAnimal(Animal $animal): static
    {
        return $this->state(fn (): array => ['animal_id' => $animal->id]);
    }

    public function from(?Beneficiary $beneficiary): static
    {
        return $this->state(fn (): array => ['from_beneficiary_id' => $beneficiary?->id]);
    }

    public function to(?Beneficiary $beneficiary): static
    {
        return $this->state(fn (): array => ['to_beneficiary_id' => $beneficiary?->id]);
    }

    public function reDispersal(): static
    {
        return $this->state(fn (): array => ['event_type' => AnimalOwnershipEvent::TYPE_RE_DISPERSAL]);
    }

    public function passOn(): static
    {
        return $this->state(fn (): array => ['event_type' => AnimalOwnershipEvent::TYPE_PASS_ON]);
    }

    public function returnToCvo(): static
    {
        return $this->state(fn (): array => [
            'event_type' => AnimalOwnershipEvent::TYPE_RETURN,
            'to_beneficiary_id' => null,
        ]);
    }

    public function voided(): static
    {
        return $this->state(fn (): array => [
            'status' => AnimalOwnershipEvent::STATUS_VOIDED,
            'voided_at' => now(),
            'void_reason' => 'Recorded in error.',
        ]);
    }
}
