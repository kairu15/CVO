<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;
use RuntimeException;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * Only the two staff accounts (one per role) and the reference data the
     * app needs to function. Accounts are keyed on `username`, so re-seeding
     * an existing database updates the old demo address in place instead of
     * creating a second row (and never violates the unique email index).
     *
     * Password: SEED_ACCOUNT_PASSWORD when set; otherwise "password" in
     * local/testing and a random value in production. A generated production
     * password is printed once here — copy it, then use the OTP reset flow to
     * choose permanent passwords.
     */
    public function run(): void
    {
        $password = trim((string) env('SEED_ACCOUNT_PASSWORD', ''));
        $generatedPassword = false;

        if ($password === '') {
            if (app()->environment(['local', 'testing'])) {
                $password = 'password';
            } else {
                $password = Str::password(24);
                $generatedPassword = true;
            }
        }

        $accounts = [
            [
                'name' => 'CVO Administrator',
                'username' => 'admin',
                'email' => 'kylleacibron@gmail.com',
                'role' => 'admin',
            ],
            [
                'name' => 'Jun Technician',
                'username' => 'technician',
                'email' => 'samplekylleuser@gmail.com',
                'role' => 'technician',
            ],
        ];

        foreach ($accounts as $account) {
            $conflict = User::withTrashed()
                ->where('email', $account['email'])
                ->where('username', '!=', $account['username'])
                ->first();

            if ($conflict) {
                throw new RuntimeException(
                    "Cannot seed {$account['username']}: {$account['email']} already belongs to another account.",
                );
            }

            $user = User::withTrashed()->updateOrCreate(
                ['username' => $account['username']],
                [
                    'name' => $account['name'],
                    'email' => $account['email'],
                    'role' => $account['role'],
                    'password' => $password,
                ],
            );

            if ($user->trashed()) {
                $user->restore();
            }
        }

        if ($generatedPassword) {
            $this->command?->warn("Generated seed-account password (shown once): {$password}");
            $this->command?->warn('Use "Forgot password?" with each Gmail address to replace it.');
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
