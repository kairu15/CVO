<?php

namespace Database\Seeders;

use App\Models\Barangay;
use App\Models\Purok;
use Illuminate\Database\Seeder;

/**
 * PLACEHOLDER puroks/sitios — replace with the real list when the CVO
 * supplies it.
 *
 * There is no authoritative purok dataset in the repo yet, so each barangay
 * gets three clearly-marked placeholder rows ("Purok 1 (placeholder)" …)
 * centred on the barangay with a small offset. The is_placeholder flag marks
 * them everywhere the API reports puroks, and a bulk delete on that flag
 * removes them cleanly:
 *
 *   php artisan db:seed --class=PurokSeeder            # (re)create
 *   php artisan tinker --execute="App\Models\Purok::where('is_placeholder', true)->delete();"
 *
 * Never surface placeholder rows to farmers without flagging them as such —
 * the register form's purok dropdown is the intended first consumer.
 */
class PurokSeeder extends Seeder
{
    public function run(): void
    {
        $count = 0;

        foreach (Barangay::all() as $barangay) {
            foreach ([1, 2, 3] as $n) {
                Purok::firstOrCreate(
                    ['barangay_id' => $barangay->id, 'name' => "Purok {$n} (placeholder)"],
                    [
                        'latitude' => $barangay->latitude + ($n - 2) * 0.0008,
                        'longitude' => $barangay->longitude + ($n - 2) * 0.0008,
                        'is_placeholder' => true,
                    ],
                );

                $count++;
            }
        }

        $this->command?->info("Seeded {$count} placeholder puroks — replace with the real list.");
    }
}
