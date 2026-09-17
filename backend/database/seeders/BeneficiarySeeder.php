<?php

namespace Database\Seeders;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * Demo beneficiaries and monitoring history.
 *
 * Mirrors the CVO's paper workflow: several barangays, each with a handful of
 * dispersed animals, some already visited by the demo technician. Uses
 * updateOrCreate-style idempotence via firstOrCreate so re-seeding never
 * duplicates the demo rows.
 */
class BeneficiarySeeder extends Seeder
{
    public function run(): void
    {
        $technician = User::where('email', 'technician@example.com')->first();
        $farmer = User::where('email', 'farmer@example.com')->first();

        if (! $technician || ! $farmer) {
            return; // demo accounts missing — nothing to attach to
        }

        $demo = [
            ['name_of_farmer' => 'Aling Nena Farmer', 'address' => 'Banay Banay', 'animal_type' => 'Carabao', 'sex' => 'F', 'farmer_id' => $farmer->id],
            ['name_of_farmer' => 'Aling Nena Farmer', 'address' => 'Banay Banay', 'animal_type' => 'Goat', 'sex' => 'M', 'farmer_id' => $farmer->id],
            ['name_of_farmer' => 'Ima Johnston', 'address' => 'Ali-Nan-Ban', 'animal_type' => 'Cattle', 'sex' => 'F', 'farmer_id' => User::where('email', 'cheyenne68@example.org')->value('id') ?? $farmer->id],
            ['name_of_farmer' => 'Doyle Walter', 'address' => 'Kalumboyan', 'animal_type' => 'Swine', 'sex' => 'F', 'farmer_id' => User::where('email', 'williamson.lafayette@example.org')->value('id') ?? $farmer->id],
            ['name_of_farmer' => 'Dave Jacobi Sr.', 'address' => 'Daw-Kal-Vil', 'animal_type' => 'Goat', 'sex' => 'M', 'farmer_id' => User::where('email', 'ecorwin@example.com')->value('id') ?? $farmer->id],
            ['name_of_farmer' => 'Miss Serenity Kozey Jr.', 'address' => 'Dawis', 'animal_type' => 'Carabao', 'sex' => 'F', 'farmer_id' => User::where('email', 'nrenner@example.net')->value('id') ?? $farmer->id],
            ['name_of_farmer' => 'Dr. Hector Ebert', 'address' => 'Cansumalig', 'animal_type' => 'Cattle', 'sex' => 'M', 'farmer_id' => User::where('email', 'shanie94@example.com')->value('id') ?? $farmer->id],
            ['name_of_farmer' => 'Vita Nicolas', 'address' => 'Tayawan', 'animal_type' => 'Boar', 'sex' => 'M', 'farmer_id' => User::where('email', 'jonathon90@example.net')->value('id') ?? $farmer->id],
        ];

        foreach ($demo as $entry) {
            $beneficiary = Beneficiary::firstOrCreate($entry, [
                'technician_id' => $technician->id,
            ]);

            // A couple of visits for the first three beneficiaries so the
            // monitoring table has history on first open.
            if ($beneficiary->wasRecentlyCreated && $beneficiary->id <= 3) {
                MonitoringRecord::factory()
                    ->count(2)
                    ->by($technician)
                    ->for($beneficiary, 'beneficiary')
                    ->create();
            }
        }
    }
}
