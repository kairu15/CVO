<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * Only the four demonstration accounts (one per role) and the reference
     * data the app needs to function — the official barangay coverage and the
     * starter health-concern hint rules. No demo beneficiaries, monitoring
     * history, dispersal chains, clinical records or projects are created;
     * those are added through the UI.
     *
     * The accounts use updateOrCreate, so re-seeding an existing database
     * resets them instead of failing on the unique email constraint.
     * Password for every account is "password".
     */
    public function run(): void
    {
        $accounts = [
            ['name' => 'CVO Administrator', 'username' => 'admin', 'email' => 'admin@example.com', 'role' => 'admin'],
            ['name' => 'Dr. Maria Santos', 'username' => 'doctor', 'email' => 'doctor@example.com', 'role' => 'doctor'],
            ['name' => 'Jun Technician', 'username' => 'technician', 'email' => 'technician@example.com', 'role' => 'technician'],
            ['name' => 'Aling Nena Farmer', 'username' => 'farmer', 'email' => 'farmer@example.com', 'role' => 'farmer'],
        ];

        foreach ($accounts as $account) {
            User::updateOrCreate(
                ['email' => $account['email']],
                [...$account, 'password' => bcrypt('password')],
            );
        }

        $this->call([
            // Official Bayawan City barangay coverage — the app's address
            // validation, geocoding fallback and `GET /api/v1/barangays` all
            // read this reference table.
            BarangaySeeder::class,

            // Admin-editable health concern hint rules (starter rows).
            SymptomRuleSeeder::class,
        ]);
    }
}
