<?php

namespace Database\Seeders;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\HealthRecord;
use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * Demo clinical data for the doctor dashboard.
 *
 * Without this, Health Records and Case Notes open empty on a freshly seeded
 * database while every other module has history — which makes the doctor
 * dashboard look broken rather than new.
 *
 * Idempotent: each beneficiary is only given records the first time, so
 * re-seeding does not pile up duplicates.
 */
class HealthRecordSeeder extends Seeder
{
    public function run(): void
    {
        $doctor = User::where('email', 'doctor@example.com')->first();

        if (! $doctor) {
            return; // demo doctor missing — nothing to author as
        }

        $beneficiaries = Beneficiary::query()->orderBy('id')->take(5)->get();

        foreach ($beneficiaries as $beneficiary) {
            if ($beneficiary->healthRecords()->exists()) {
                continue;
            }

            HealthRecord::factory()
                ->count(2)
                ->by($doctor)
                ->forBeneficiary($beneficiary)
                ->create();

            CaseNote::factory()
                ->by($doctor)
                ->forBeneficiary($beneficiary)
                ->create();
        }
    }
}
