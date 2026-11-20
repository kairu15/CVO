<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\FieldVisitPlan;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TechnicianDashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_dashboard_is_task_oriented_and_scoped_to_the_technician(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $other = User::factory()->create(['role' => 'technician']);

        $mine = Beneficiary::factory()->assignedTo($technician)->create([
            'name_of_farmer' => 'My Farmer',
            'address' => 'Dawis',
        ]);
        $theirs = Beneficiary::factory()->assignedTo($other)->create([
            'name_of_farmer' => 'Other Farmer',
            'address' => 'Dawis',
        ]);

        FieldVisitPlan::create([
            'beneficiary_id' => $mine->id,
            'technician_id' => $technician->id,
            'planned_for' => today(),
            'purpose' => 'routine-monitoring',
            'status' => FieldVisitPlan::STATUS_PENDING,
        ]);
        FieldVisitPlan::create([
            'beneficiary_id' => $mine->id,
            'technician_id' => $technician->id,
            'planned_for' => today()->subDay(),
            'purpose' => 'dispersal',
            'status' => FieldVisitPlan::STATUS_IN_PROGRESS,
        ]);
        FieldVisitPlan::create([
            'beneficiary_id' => $mine->id,
            'technician_id' => $technician->id,
            'planned_for' => today()->addDays(2),
            'purpose' => 'routine-monitoring',
            'status' => FieldVisitPlan::STATUS_PENDING,
        ]);
        FieldVisitPlan::create([
            'beneficiary_id' => $theirs->id,
            'technician_id' => $other->id,
            'planned_for' => today(),
            'purpose' => 'routine-monitoring',
            'status' => FieldVisitPlan::STATUS_PENDING,
        ]);

        FieldVisit::factory()->by($technician)->forBeneficiary($mine)->create([
            'visited_on' => today(),
            'purpose' => 'routine-monitoring',
        ]);
        MonitoringRecord::factory()->create([
            'beneficiary_id' => $mine->id,
            'technician_id' => $technician->id,
            'date_monitored' => today(),
        ]);

        $this->actingAs($technician)
            ->getJson('/api/v1/technician/dashboard')
            ->assertOk()
            ->assertJsonPath('data.counts.assigned_beneficiaries', 1)
            ->assertJsonPath('data.counts.today_tasks', 2)
            ->assertJsonPath('data.counts.overdue_tasks', 1)
            ->assertJsonPath('data.counts.visits_today', 1)
            ->assertJsonPath('data.counts.pending_field_visits', 3)
            ->assertJsonPath('data.counts.completed_field_visits', 1)
            ->assertJsonPath('data.counts.pending_dispersals', 1)
            ->assertJsonCount(2, 'data.today_tasks')
            ->assertJsonCount(1, 'data.upcoming_tasks')
            ->assertJsonCount(3, 'data.assigned_tasks')
            ->assertJsonPath('data.assigned_tasks.0.status', 'overdue')
            ->assertJsonPath('data.assigned_tasks.0.task_type', 'Field visit')
            ->assertJsonPath('data.today_tasks.0.is_overdue', true)
            ->assertJsonPath('data.today_tasks.0.name_of_farmer', 'My Farmer')
            ->assertJsonPath('data.assigned_beneficiaries.0.name_of_farmer', 'My Farmer')
            ->assertJsonMissing(['name_of_farmer' => 'Other Farmer'])
            ->assertJsonPath('data.barangays.0.name', 'Dawis')
            ->assertJsonPath('data.barangays.0.total', 1)
            ->assertJsonPath('data.map.mapped', 1)
            ->assertJsonPath('data.map.unlocated', 0)
            ->assertJsonPath('data.map_households.0.name_of_farmer', 'My Farmer')
            ->assertJsonPath('data.map_households.0.approximate', false)
            ->assertJsonStructure([
                'data' => [
                    'generated_at', 'counts', 'today_tasks', 'upcoming_tasks',
                    'assigned_tasks', 'overdue_households', 'assigned_beneficiaries',
                    'recent_activity', 'barangays', 'map_households', 'map',
                    'purposes', 'window_days',
                ],
            ]);

        $this->assertCount(2, $this->getJson('/api/v1/technician/dashboard')->json('data.recent_activity'));
    }

    public function test_recent_activity_includes_dispersal_and_beneficiary_updates(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create([
            'name_of_farmer' => 'Dispersal Farmer',
        ]);

        ActivityLog::create([
            'actor_id' => $technician->id,
            'actor_role' => 'technician',
            'action' => 'dispersal_recorded',
            'target_type' => 'AnimalOwnershipEvent',
            'target_id' => 10,
            'context' => [
                'animal_id' => 5,
                'ear_tag_number' => 'CVO-77',
                'to_beneficiary_id' => $beneficiary->id,
                'event_date' => today()->toDateString(),
            ],
        ]);

        ActivityLog::create([
            'actor_id' => $technician->id,
            'actor_role' => 'technician',
            'action' => 'beneficiary_updated',
            'target_type' => 'Beneficiary',
            'target_id' => $beneficiary->id,
        ]);

        $activity = collect(
            $this->actingAs($technician)
                ->getJson('/api/v1/technician/dashboard')
                ->assertOk()
                ->json('data.recent_activity'),
        );

        $dispersal = $activity->firstWhere('type', 'dispersal');
        $this->assertNotNull($dispersal);
        $this->assertSame('Dispersal recorded', $dispersal['label']);
        $this->assertSame('Recorded', $dispersal['status_label']);
        $this->assertStringContainsString('CVO-77', $dispersal['subject']);
        $this->assertStringContainsString('Dispersal Farmer', $dispersal['subject']);

        $updated = $activity->firstWhere('type', 'beneficiary');
        $this->assertNotNull($updated);
        $this->assertSame('Beneficiary record updated', $updated['label']);
        $this->assertSame('Dispersal Farmer', $updated['subject']);
    }

    public function test_the_assigned_beneficiary_filter_returns_only_the_callers_households(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $other = User::factory()->create(['role' => 'technician']);
        $mine = Beneficiary::factory()->assignedTo($technician)->create();
        Beneficiary::factory()->assignedTo($other)->create();

        $this->actingAs($technician)
            ->getJson('/api/v1/beneficiaries?assigned=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $mine->id);
    }

    public function test_a_technician_can_schedule_a_visit_for_an_assigned_household(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();

        $this->actingAs($technician)->postJson('/api/v1/technician/visit-plans', [
            'beneficiary_id' => $beneficiary->id,
            'planned_for' => today()->addDay()->toDateString(),
            'purpose' => 'routine-monitoring',
            'notes' => 'Bring the vaccination record.',
        ])->assertCreated()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.beneficiary_id', $beneficiary->id);

        $this->assertDatabaseHas('field_visit_plans', [
            'beneficiary_id' => $beneficiary->id,
            'technician_id' => $technician->id,
            'status' => 'pending',
        ]);
    }

    public function test_a_technician_cannot_schedule_another_technicians_household(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $other = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($other)->create();

        $this->actingAs($technician)->postJson('/api/v1/technician/visit-plans', [
            'beneficiary_id' => $beneficiary->id,
            'planned_for' => today()->toDateString(),
            'purpose' => 'routine-monitoring',
        ])->assertUnprocessable()->assertJsonValidationErrors('beneficiary_id');

        $this->assertDatabaseCount('field_visit_plans', 0);
    }

    public function test_an_open_plan_cannot_be_duplicated_for_the_same_household_and_date(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();

        FieldVisitPlan::create([
            'beneficiary_id' => $beneficiary->id,
            'technician_id' => $technician->id,
            'planned_for' => today(),
            'purpose' => 'routine-monitoring',
            'status' => FieldVisitPlan::STATUS_PENDING,
        ]);

        $this->actingAs($technician)->postJson('/api/v1/technician/visit-plans', [
            'beneficiary_id' => $beneficiary->id,
            'planned_for' => today()->toDateString(),
            'purpose' => 'dispersal',
        ])->assertUnprocessable()->assertJsonValidationErrors('beneficiary_id');

        $this->assertDatabaseCount('field_visit_plans', 1);
    }

    public function test_a_plan_moves_to_in_progress_then_completes_with_the_visit(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();
        $plan = FieldVisitPlan::create([
            'beneficiary_id' => $beneficiary->id,
            'technician_id' => $technician->id,
            'planned_for' => today(),
            'purpose' => 'routine-monitoring',
            'status' => FieldVisitPlan::STATUS_PENDING,
        ]);

        $this->actingAs($technician)->patchJson("/api/v1/technician/visit-plans/{$plan->id}", [
            'status' => 'in_progress',
        ])->assertOk()->assertJsonPath('data.status', 'in_progress');

        $visit = FieldVisit::factory()->by($technician)->forBeneficiary($beneficiary)->create([
            'visited_on' => today(),
        ]);

        $this->actingAs($technician)->patchJson("/api/v1/technician/visit-plans/{$plan->id}", [
            'status' => 'completed',
            'field_visit_id' => $visit->id,
        ])->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.field_visit_id', $visit->id);

        $this->assertNotNull($plan->refresh()->completed_at);
    }

    public function test_completing_a_plan_requires_a_matching_visit(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();
        $plan = FieldVisitPlan::create([
            'beneficiary_id' => $beneficiary->id,
            'technician_id' => $technician->id,
            'planned_for' => today(),
            'purpose' => 'routine-monitoring',
            'status' => FieldVisitPlan::STATUS_PENDING,
        ]);

        $this->actingAs($technician)->patchJson("/api/v1/technician/visit-plans/{$plan->id}", [
            'status' => 'completed',
        ])->assertUnprocessable()->assertJsonValidationErrors('field_visit_id');

        $this->actingAs($technician)->patchJson("/api/v1/technician/visit-plans/{$plan->id}", [
            'status' => 'completed',
            'field_visit_id' => 999999,
        ])->assertUnprocessable()->assertJsonValidationErrors('field_visit_id');
    }

    public function test_a_technician_cannot_update_another_technicians_plan(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $other = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($other)->create();
        $plan = FieldVisitPlan::create([
            'beneficiary_id' => $beneficiary->id,
            'technician_id' => $other->id,
            'planned_for' => today(),
            'purpose' => 'routine-monitoring',
            'status' => FieldVisitPlan::STATUS_PENDING,
        ]);

        $this->actingAs($technician)->patchJson("/api/v1/technician/visit-plans/{$plan->id}", [
            'status' => 'in_progress',
        ])->assertForbidden();
    }

    public function test_the_dashboard_and_plan_routes_require_authentication(): void
    {
        $this->getJson('/api/v1/technician/dashboard')->assertUnauthorized();
        $this->postJson('/api/v1/technician/visit-plans', [])->assertUnauthorized();
    }
}
