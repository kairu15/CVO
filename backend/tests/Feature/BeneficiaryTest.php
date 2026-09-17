<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BeneficiaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_guests_cannot_list_beneficiaries(): void
    {
        $this->getJson('/api/v1/beneficiaries')->assertUnauthorized();
    }

    public function test_farmers_see_only_their_own_beneficiaries(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        Beneficiary::factory()->count(2)->forFarmer($farmer)->create();
        Beneficiary::factory()->create(); // someone else's

        $response = $this->actingAs($farmer)->getJson('/api/v1/beneficiaries');

        $response->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_technicians_see_only_assigned_beneficiaries(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        Beneficiary::factory()->count(2)->assignedTo($technician)->create();
        Beneficiary::factory()->create(); // unassigned

        $response = $this->actingAs($technician)->getJson('/api/v1/beneficiaries');

        $response->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_admin_sees_all_beneficiaries(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Beneficiary::factory()->count(3)->create();

        $response = $this->actingAs($admin)->getJson('/api/v1/beneficiaries');

        $response->assertOk()->assertJsonCount(3, 'data');
    }

    public function test_farmer_registration_can_create_a_beneficiary(): void
    {
        $response = $this->postJson('/api/v1/register', [
            'name' => 'Juan Dela Cruz',
            'username' => 'juan',
            'email' => 'juan@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'address' => 'Banay Banay',
            'animal_type' => 'Carabao',
            'sex' => 'F',
        ]);

        $response->assertCreated();

        $this->assertDatabaseHas('beneficiaries', [
            'name_of_farmer' => 'Juan Dela Cruz',
            'address' => 'Banay Banay',
            'animal_type' => 'Carabao',
            'sex' => 'F',
        ]);
    }

    public function test_registration_without_dispersal_details_creates_no_beneficiary(): void
    {
        $this->postJson('/api/v1/register', [
            'name' => 'Plain',
            'username' => 'plain',
            'email' => 'plain@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
        ]);

        $this->assertDatabaseMissing('beneficiaries', [
            'address' => null,
        ]);
    }

    public function test_farmers_cannot_assign_technicians(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->create();
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($farmer)
            ->patchJson("/api/v1/admin/beneficiaries/{$beneficiary->id}/assign-technician", [
                'technician_id' => $technician->id,
            ])
            ->assertForbidden();
    }

    public function test_admin_can_assign_a_technician(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create();
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/beneficiaries/{$beneficiary->id}/assign-technician", [
                'technician_id' => $technician->id,
            ])
            ->assertOk()
            ->assertJsonPath('data.technician_id', $technician->id);

        $this->assertDatabaseHas('beneficiaries', [
            'id' => $beneficiary->id,
            'technician_id' => $technician->id,
        ]);
    }

    public function test_admin_cannot_assign_a_non_technician_user(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create();
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/beneficiaries/{$beneficiary->id}/assign-technician", [
                'technician_id' => $farmer->id,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['technician_id']);
    }
}
