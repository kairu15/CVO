<?php

namespace Database\Seeders;

use App\Models\Beneficiary;
use Database\Factories\BeneficiaryFactory;
use Illuminate\Database\Seeder;

/**
 * One-off backfill: give beneficiaries that pre-date the geo-tagging columns
 * plausible Negros Oriental coordinates so the dispersal map has data to show
 * on an existing database. Run with:
 *
 *   php artisan db:seed --class=BeneficiaryGeoBackfillSeeder
 *
 * Idempotent — only fills rows whose latitude/longitude are still null.
 */
class BeneficiaryGeoBackfillSeeder extends Seeder
{
    public function run(): void
    {
        $coords = BeneficiaryFactory::BARANGAY_COORDS;

        $pending = Beneficiary::query()
            ->whereNull('latitude')
            ->orWhereNull('longitude')
            ->get();

        foreach ($pending as $beneficiary) {
            $known = $coords[$beneficiary->address] ?? null;

            if ($known) {
                [$lat, $lng] = $known;
                // Small deterministic jitter per row so same-barangay markers
                // don't stack on the map.
                $lat += (mt_rand(-400, 400) / 100000);
                $lng += (mt_rand(-400, 400) / 100000);
            } else {
                // Unknown barangay: drop it near the Bayawan City centre.
                [$lat, $lng] = [9.3638, 122.8022];
                $lat += (mt_rand(-800, 800) / 100000);
                $lng += (mt_rand(-800, 800) / 100000);
            }

            $beneficiary->update(['latitude' => $lat, 'longitude' => $lng]);
        }

        $this->command?->info("Geo-tagged {$pending->count()} beneficiary rows.");
    }
}
