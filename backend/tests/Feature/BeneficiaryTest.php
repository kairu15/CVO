<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\TechnicianAssignment;
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

    public function test_technician_direct_fetch_of_an_unassigned_beneficiary_is_403(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $mine = Beneficiary::factory()->assignedTo($technician)->create();
        $other = Beneficiary::factory()->create(); // exists, assigned to nobody

        // Assigned: fine. Unassigned but existing: an explicit 403 — a
        // permissions boundary, not a missing row.
        $this->actingAs($technician)
            ->getJson("/api/v1/beneficiaries/{$mine->id}")
            ->assertOk();

        $this->actingAs($technician)
            ->getJson("/api/v1/beneficiaries/{$other->id}")
            ->assertForbidden()
            ->assertJsonPath('message', 'This farmer is not assigned to you.');
    }

    public function test_a_missing_beneficiary_is_still_404_for_a_technician(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($technician)
            ->getJson('/api/v1/beneficiaries/999999')
            ->assertNotFound();
    }

    public function test_reassignment_moves_visibility_between_technicians(): void
    {
        $first = User::factory()->create(['role' => 'technician']);
        $second = User::factory()->create(['role' => 'technician']);
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->assignedTo($first)->create();

        // Before: only the first technician can see it; the second hits 403.
        $this->actingAs($first)->getJson("/api/v1/beneficiaries/{$beneficiary->id}")->assertOk();
        $this->actingAs($second)->getJson("/api/v1/beneficiaries/{$beneficiary->id}")->assertForbidden();

        // Admin reassigns to the second technician.
        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/beneficiaries/{$beneficiary->id}/assign-technician", [
                'technician_id' => $second->id,
            ])->assertOk();

        // After: access has flipped — the first is now the one outside.
        $this->actingAs($second)->getJson("/api/v1/beneficiaries/{$beneficiary->id}")->assertOk();
        $this->actingAs($first)->getJson("/api/v1/beneficiaries/{$beneficiary->id}")->assertForbidden();

        // The audit trail recorded the chain: null → first → second.
        $this->assertDatabaseHas('technician_assignments', [
            'beneficiary_id' => $beneficiary->id,
            'technician_id' => $second->id,
            'previous_technician_id' => $first->id,
            'assigned_by' => $admin->id,
        ]);
    }

    public function test_clearing_an_assignment_revokes_technician_access(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();

        $this->actingAs($admin)
            ->patchJson("/api/v1/admin/beneficiaries/{$beneficiary->id}/assign-technician", [
                'technician_id' => null,
            ])->assertOk();

        $this->actingAs($technician)
            ->getJson("/api/v1/beneficiaries/{$beneficiary->id}")
            ->assertForbidden();
    }

    public function test_technician_scoping_covers_monitoring_records(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $mine = Beneficiary::factory()->assignedTo($technician)->create();
        $other = Beneficiary::factory()->create();

        MonitoringRecord::factory()->count(2)->create(['beneficiary_id' => $mine->id]);
        MonitoringRecord::factory()->create(['beneficiary_id' => $other->id]);

        // The monitoring list is scoped through the same beneficiary query —
        // only records of assigned households can appear.
        $response = $this->actingAs($technician)->getJson('/api/v1/monitoring-records');
        $ids = collect($response->assertOk()->json('data'))->pluck('beneficiary_id')->unique();

        $this->assertSame([$mine->id], $ids->values()->all());
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
            'address' => 'Banaybanay',
            'animal_type' => 'Carabao',
            'sex' => 'F',
        ]);

        $response->assertCreated();

        $this->assertDatabaseHas('beneficiaries', [
            'name_of_farmer' => 'Juan Dela Cruz',
            'address' => 'Banaybanay',
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
