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

    public function test_the_directory_honours_per_page_so_it_matches_the_monitoring_table(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Beneficiary::factory()->count(25)->create();

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=200')
            ->assertOk()
            ->assertJsonCount(25, 'data');

        // The plain call still behaves like a normal paginated list.
        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries')
            ->assertOk()
            ->assertJsonCount(15, 'data');
    }

    public function test_the_directory_still_filters_by_farmer_name_and_address(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Beneficiary::factory()->create(['name_of_farmer' => 'Nena Reyes', 'address' => 'Dawis']);
        Beneficiary::factory()->create(['name_of_farmer' => 'Other Farmer', 'address' => 'Tayawan']);
        Beneficiary::factory()->count(3)->create();

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

    public function test_the_directory_rejects_an_out_of_range_per_page(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=5000')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['per_page']);
    }
}
