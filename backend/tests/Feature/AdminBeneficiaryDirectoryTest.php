<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The admin beneficiaries directory backs the technician-assignment screen.
 * It used to hard-code paginate(15), so the page showed 15 households while
 * the monitoring table reported on hundreds — the two screens disagreed about
 * how big the program is.
 */
class AdminBeneficiaryDirectoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_directory_defaults_to_fifty_and_caps_per_page_at_fifty(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Beneficiary::factory()->count(60)->create();

        // The plain call is a normal paginated list whose default page is 50.
        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries')
            ->assertOk()
            ->assertJsonCount(50, 'data')
            ->assertJsonPath('meta.per_page', 50)
            ->assertJsonPath('meta.total', 60);

        // An over-limit `per_page` is clamped to 50, not rejected.
        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=200')
            ->assertOk()
            ->assertJsonCount(50, 'data')
            ->assertJsonPath('meta.per_page', 50);
    }

    public function test_the_directory_still_filters_by_farmer_name_and_address(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Beneficiary::factory()->create(['name_of_farmer' => 'Nena Reyes', 'address' => 'Dawis']);
        Beneficiary::factory()->create(['name_of_farmer' => 'Other Farmer', 'address' => 'Tayawan']);
        // Pin the filler rows' address: the factory picks a random barangay, and
        // "Tayawan" is among them, which would make the search assertions below
        // flaky.
        Beneficiary::factory()->count(3)->create(['address' => 'Dawis']);

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=200&search=Nena')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=200&search=Tayawan')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_the_directory_rejects_a_non_admin(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor']);

        $this->actingAs($doctor)
            ->getJson('/api/v1/admin/beneficiaries')
            ->assertForbidden();
    }

    public function test_the_directory_rejects_a_non_integer_per_page(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=abc')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['per_page']);
    }
}
