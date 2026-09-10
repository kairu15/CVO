<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Demo admin
        User::factory()->create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => bcrypt('password'),
            'role' => 'admin',
        ]);

        // Demo member with projects
        $member = User::factory()->create([
            'name' => 'Demo Member',
            'email' => 'member@example.com',
            'password' => bcrypt('password'),
            'role' => 'member',
        ]);

        $this->call([
            ProjectSeeder::class,
        ]);

        $member->projects()->createMany(
            \App\Models\Project::factory()->count(3)->make()->each(fn ($p) => $p->setAttribute('user_id', $member->id))->toArray(),
        );
    }
}
