<?php

namespace Database\Seeders;

use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * One demo account per role so each dashboard shell can be opened without
     * hand-editing the users table. Password is "password".
     *
     * The accounts use updateOrCreate, so re-seeding an existing database
     * resets them instead of failing on the unique email constraint.
     */
    public function run(): void
    {
        $accounts = [
            ['name' => 'CVO Administrator', 'username' => 'admin', 'email' => 'admin@example.com', 'role' => 'admin'],
            ['name' => 'Dr. Maria Santos', 'username' => 'doctor', 'email' => 'doctor@example.com', 'role' => 'doctor'],
            ['name' => 'Jun Technician', 'username' => 'technician', 'email' => 'technician@example.com', 'role' => 'technician'],
            ['name' => 'Aling Nena Farmer', 'username' => 'farmer', 'email' => 'farmer@example.com', 'role' => 'farmer'],
        ];

        $users = [];

        foreach ($accounts as $account) {
            $users[$account['role']] = User::updateOrCreate(
                ['email' => $account['email']],
                [...$account, 'password' => bcrypt('password')],
            );
        }

        $this->call([
            ProjectSeeder::class,
            BeneficiarySeeder::class,
            DispersalChainSeeder::class,
            BeneficiaryGeoBackfillSeeder::class,
            // Needs beneficiaries to exist first, so it runs last.
            HealthRecordSeeder::class,
        ]);

        $farmer = $users['farmer'];

        // Only populate the demo projects once, so repeated seeding does not
        // keep piling up rows.
        if ($farmer->projects()->doesntExist()) {
            $farmer->projects()->createMany(
                Project::factory()->count(3)->make()->each(fn ($p) => $p->setAttribute('user_id', $farmer->id))->toArray(),
            );
        }
    }
}
