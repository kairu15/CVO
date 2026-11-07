<?php

namespace Database\Factories;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CaseNote>
 */
class CaseNoteFactory extends Factory
{
    public function definition(): array
    {
        return [
            'beneficiary_id' => Beneficiary::factory(),
            // doctor_id is the attending veterinarian / author of the note
            // (a schema name, not a role) — authored by a technician account.
            'doctor_id' => User::factory()->create(['role' => 'technician'])->id,
            'date_noted' => fake()->dateTimeBetween('-6 months', 'now'),
            'body' => fake()->randomElement([
                'Owner phoned — the animal is still limping, advised to rest it for a week.',
                'Referred to the provincial veterinary office for an ultrasound.',
                'Advised isolating the rest of the herd until the fever clears.',
                'Follow-up visit done, no further treatment needed.',
                'Owner reported the animal is eating normally again.',
            ]),
        ];
    }

    /** Write the note as an existing veterinarian. */
    public function by(User $doctor): static
    {
        return $this->state(fn () => ['doctor_id' => $doctor->id]);
    }

    /** Attach the note to an existing beneficiary. */
    public function forBeneficiary(Beneficiary $beneficiary): static
    {
        return $this->state(fn () => ['beneficiary_id' => $beneficiary->id]);
    }
}
