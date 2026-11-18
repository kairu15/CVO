<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The admin Technicians screen.
 *
 * The figures are all derived — assigned households are beneficiary rows,
 * completed visits are field_visits rows, and "due" reuses the shared 60-day
 * contact window — so these tests pin the read model and the filters rather
 * than a second copy of the data.
 */
class TechnicianDirectoryTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
    }

    public function test_directory_reports_stats_workload_and_visit_metrics(): void
    {
        $technician = User::factory()->create(['role' => 'technician', 'name' => 'Alpha Tech']);
        $inactive = User::factory()->create(['role' => 'technician', 'name' => 'Beta Tech']);
        $inactive->delete();

        $dawis = Beneficiary::factory()->assignedTo($technician)->create([
            'name_of_farmer' => 'Nena Santos',
            'address' => 'Dawis',
        ]);
        Beneficiary::factory()->assignedTo($technician)->create([
            'name_of_farmer' => 'Doyle Walter',
            'address' => 'Tinago (Poblacion)',
        ]);
        Beneficiary::factory()->assignedTo($technician)->create([
            'name_of_farmer' => 'No Visit Yet',
            'address' => 'Dawis',
        ]);

        FieldVisit::factory()->by($technician)->forBeneficiary($dawis)->create([
            'visited_on' => now()->subDays(5)->toDateString(),
            'purpose' => 'follow-up',
        ]);
        FieldVisit::factory()->by($technician)->forBeneficiary($dawis)->create([
            'visited_on' => now()->subDays(90)->toDateString(),
            'purpose' => 'monitoring',
        ]);

        ActivityLog::create([
            'actor_id' => $technician->id,
            'actor_role' => 'technician',
            'action' => 'field_visit_created',
            'target_type' => 'FieldVisit',
            'target_id' => 1,
        ]);

        $response = $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/technicians')
            ->assertOk()
            ->assertJsonPath('summary.total', 2)
            ->assertJsonPath('summary.active', 1)
            ->assertJsonPath('summary.deactivated', 1)
            ->assertJsonPath('summary.with_assignments', 1)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Alpha Tech')
            ->assertJsonPath('data.0.status', 'active')
            ->assertJsonPath('data.0.assigned_households', 3)
            ->assertJsonPath('data.0.visits_completed', 2)
            ->assertJsonPath('data.0.visits_30d', 1)
            ->assertJsonPath('data.0.visited_households_30d', 1)
            ->assertJsonPath('data.0.due_households', 2)
            ->assertJsonPath('data.0.coverage_pct', 33)
            ->assertJsonPath('data.0.workload.key', 'light')
            ->assertJsonPath('data.0.barangays.0', 'Dawis')
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('unassigned.total', 0);

        $detail = $this->actingAs($this->admin)
            ->getJson("/api/v1/admin/technicians/{$technician->id}")
            ->assertOk()
            ->assertJsonPath('data.name', 'Alpha Tech')
            ->assertJsonPath('data.barangays.0.name', 'Dawis')
            ->assertJsonPath('data.barangays.0.households', 2)
            ->assertJsonCount(3, 'data.assignments')
            ->assertJsonCount(2, 'data.recent_visits')
            ->assertJsonPath('data.recent_visits.0.purpose', 'follow-up')
            ->assertJsonPath('data.recent_activity.0.action', 'field_visit_created');

        $this->assertNotEmpty($detail->json('data.recent_activity'));
    }

    public function test_search_status_barangay_and_workload_filters_run_server_side(): void
    {
        $light = User::factory()->create(['role' => 'technician', 'name' => 'Light Tech']);
        $moderate = User::factory()->create(['role' => 'technician', 'name' => 'Moderate Tech']);
        $idle = User::factory()->create(['role' => 'technician', 'name' => 'Idle Tech']);

        Beneficiary::factory()->assignedTo($light)->create(['address' => 'Dawis']);
        Beneficiary::factory()->assignedTo($moderate)->count(11)->create(['address' => 'Tinago (Poblacion)']);

        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/technicians?workload=light')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Light Tech');

        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/technicians?workload=moderate')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Moderate Tech')
            ->assertJsonPath('data.0.workload.key', 'moderate');

        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/technicians?workload=unassigned')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Idle Tech');

        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/technicians?search=Light')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Light Tech');

        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/technicians?barangay=Tinago')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Moderate Tech');

        $idle->delete();
        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/technicians?status=deactivated')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Idle Tech')
            ->assertJsonPath('data.0.status', 'deactivated');
    }

    public function test_a_deactivated_technician_cannot_receive_households(): void
    {
        $inactive = User::factory()->create(['role' => 'technician']);
        $inactive->delete();

        $beneficiary = Beneficiary::factory()->create();

        $this->actingAs($this->admin)
            ->patchJson("/api/v1/admin/beneficiaries/{$beneficiary->id}/assign-technician", [
                'technician_id' => $inactive->id,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['technician_id']);

        $this->actingAs($this->admin)
            ->patchJson('/api/v1/admin/beneficiaries/bulk-assign-technician', [
                'ids' => [$beneficiary->id],
                'technician_id' => $inactive->id,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['technician_id']);
    }

    public function test_a_technician_cannot_read_the_directory(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($technician)
            ->getJson('/api/v1/admin/technicians')
            ->assertForbidden();

        $this->actingAs($technician)
            ->getJson("/api/v1/admin/technicians/{$technician->id}")
            ->assertForbidden();
    }
}
