<?php

namespace Database\Seeders;

use App\Models\Barangay;
use App\Models\Beneficiary;
use App\Support\Barangays;
use Illuminate\Database\Seeder;

/**
 * The 28 official Bayawan City barangays, seeded from config/barangays.php
 * (coordinates geocoded from OpenStreetMap, 2026-09).
 *
 * Idempotent via updateOrCreate on the unique name. Also backfills
 * beneficiaries.barangay_id from the address string for rows created before
 * the FK columns existed, so a re-seed repairs existing dev databases.
 */
class BarangaySeeder extends Seeder
{
    public function run(): void
    {
        foreach (config('barangays.entries', []) as $entry) {
            Barangay::updateOrCreate(
                ['name' => $entry['name']],
                ['latitude' => $entry['latitude'], 'longitude' => $entry['longitude']],
            );
        }

        // Repair pass: legacy rows matched by (normalized) address only.
        $matchable = Barangays::centers();

        Beneficiary::query()
            ->whereNull('barangay_id')
            ->get(['id', 'address'])
            ->each(function (Beneficiary $beneficiary) use ($matchable): void {
                $name = Barangays::normalize($beneficiary->address);

                if (isset($matchable[$name])) {
                    $beneficiary->forceFill(['barangay_id' => Barangays::idFor($name)])->save();
                }
            });

        $this->command?->info('Seeded '.Barangay::count().' official barangays.');
    }
}
