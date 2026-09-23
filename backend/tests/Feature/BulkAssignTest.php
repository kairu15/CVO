<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BulkAssignTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_bulk_assign_a_technician(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiaries = Beneficiary::factory()->count(3)->create();

        $response = $this->actingAs($admin)
            ->patchJson('/api/v1/admin/beneficiaries/bulk-assign-technician', [
                'ids' => $beneficiaries->pluck('id'),
                'technician_id' => $technician->id,
            ])
            ->assertOk()
            ->assertJsonPath('data.updated', 3)
            ->assertJsonPath('data.failed_ids', []);

        foreach ($beneficiaries as $beneficiary) {
            $this->assertDatabaseHas('beneficiaries', [
                'id' => $beneficiary->id,
                'technician_id' => $technician->id,
            ]);
        }
    }

    public function test_admin_can_bulk_detach_technicians(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiaries = Beneficiary::factory()->count(2)->assignedTo($technician)->create();

        $this->actingAs($admin)
            ->patchJson('/api/v1/admin/beneficiaries/bulk-assign-technician', [
                'ids' => $beneficiaries->pluck('id'),
                'technician_id' => null,
            ])
            ->assertOk()
            ->assertJsonPath('data.updated', 2);

        $this->assertDatabaseHas('beneficiaries', [
            'id' => $beneficiaries[0]->id,
            'technician_id' => null,
        ]);
    }

    public function test_bulk_assign_reports_missing_ids_as_failed(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create();

        $this->actingAs($admin)
            ->patchJson('/api/v1/admin/beneficiaries/bulk-assign-technician', [
                'ids' => [$beneficiary->id, 999999],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['ids.1']);
    }

    public function test_bulk_assign_rejects_a_non_technician_user(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()->create();

        $this->actingAs($admin)
            ->patchJson('/api/v1/admin/beneficiaries/bulk-assign-technician', [
                'ids' => [$beneficiary->id],
                'technician_id' => $farmer->id,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['technician_id']);
    }

    public function test_technicians_cannot_bulk_assign(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->create();

        $this->actingAs($technician)
            ->patchJson('/api/v1/admin/beneficiaries/bulk-assign-technician', [
                'ids' => [$beneficiary->id],
            ])
            ->assertForbidden();
    }
}
