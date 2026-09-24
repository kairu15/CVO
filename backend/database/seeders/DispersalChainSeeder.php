<?php

namespace Database\Seeders;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\MonitoringRecord;
use App\Models\User;
use Database\Factories\BeneficiaryFactory;
use Illuminate\Database\Seeder;

/**
 * Demo re-dispersal (pass-on) chain.
 *
 * The demo farmer's first carabao is traced through two pass-on generations:
 * Aling Nena (Banay Banay) -> a new recipient in Kalumboyan -> another new
 * recipient in Dawis. Each hop creates a fresh beneficiary row (with its own
 * demo farmer account) plus the dispersal event linking it to its parent.
 *
 * Idempotent via firstOrCreate on the demo farmer emails.
 */
class DispersalChainSeeder extends Seeder
{
    public function run(): void
    {
        $technician = User::where('email', 'technician@example.com')->first();
        $original = Beneficiary::query()
            ->where('address', 'Banaybanay')
            ->where('animal_type', 'Carabao')
            ->first();

        if (! $technician || ! $original) {
            return; // demo accounts / seed data missing — nothing to chain from
        }

        // The initial dispersal that started the chain.
        DispersalEvent::firstOrCreate([
            'beneficiary_id' => $original->id,
            'dispersal_type' => DispersalEvent::TYPE_INITIAL,
        ], [
            'parent_beneficiary_id' => null,
            'new_beneficiary_id' => null,
            'date_dispersed' => now()->subMonths(14)->toDateString(),
            'remarks' => 'Initial program dispersal (demo data).',
        ]);

        $hops = [
            ['name_of_farmer' => 'Rodrigo Pasahan', 'address' => 'Kalumboyan', 'animal_type' => 'Carabao', 'sex' => 'F', 'months_ago' => 8],
            ['name_of_farmer' => 'Marites Sugo', 'address' => 'Dawis', 'animal_type' => 'Carabao', 'sex' => 'F', 'months_ago' => 3],
        ];

        $parent = $original;

        foreach ($hops as $hop) {
            $recipientFarmer = User::firstOrCreate([
                'email' => strtolower(str_replace(' ', '.', $hop['name_of_farmer'])).'@example.com',
            ], [
                'name' => $hop['name_of_farmer'],
                'username' => strtolower(str_replace(' ', '_', $hop['name_of_farmer'])),
                'password' => bcrypt('password'),
                'role' => 'farmer',
            ]);

            $recipient = Beneficiary::firstOrCreate([
                'name_of_farmer' => $hop['name_of_farmer'],
                'address' => $hop['address'],
                'animal_type' => $hop['animal_type'],
            ], [
                'farmer_id' => $recipientFarmer->id,
                'sex' => $hop['sex'],
                'technician_id' => $technician->id,
                'latitude' => (BeneficiaryFactory::BARANGAY_COORDS()[$hop['address']][0]) + (mt_rand(-300, 300) / 100000),
                'longitude' => (BeneficiaryFactory::BARANGAY_COORDS()[$hop['address']][1]) + (mt_rand(-300, 300) / 100000),
            ]);

            DispersalEvent::firstOrCreate([
                'beneficiary_id' => $recipient->id,
                'dispersal_type' => DispersalEvent::TYPE_RE_DISPERSAL,
            ], [
                'parent_beneficiary_id' => $parent->id,
                'new_beneficiary_id' => $recipient->id,
                'date_dispersed' => now()->subMonths($hop['months_ago'])->toDateString(),
                'remarks' => "Offspring of {$parent->name_of_farmer}'s animal passed on to {$hop['name_of_farmer']} (demo data).",
            ]);

            // A visit on the new recipient so monitoring has history too.
            if ($recipient->wasRecentlyCreated) {
                MonitoringRecord::factory()
                    ->count(1)
                    ->by($technician)
                    ->for($recipient, 'beneficiary')
                    ->create();
            }

            $parent = $recipient;
        }
    }
}
