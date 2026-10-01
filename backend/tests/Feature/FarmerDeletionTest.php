<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\DispersalEvent;
use App\Models\FieldVisit;
use App\Models\FieldVisitPhoto;
use App\Models\HealthRecord;
use App\Models\MonitoringRecord;
use App\Models\TechnicianAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Deleting a farmer from the admin Monitoring Records table must remove the
 * farmer's data across the WHOLE system, not just the monitoring_records row.
 *
 * The delete is a SOFT delete (LGU retention/audit): the farmer, their
 * household and every related row are marked deleted and vanish from every
 * list, report and alert — but remain in the database. Only registration rows
 * (registration_status != none) trigger the full removal; an ordinary visit
 * row stays a record-only delete.
 */
class FarmerDeletionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
    }

    /** Register a farmer through the real endpoint (creates user + beneficiary + record). */
    private function registerFarmer(): array
    {
        $name = 'Del Farmer '.uniqid();

        $this->postJson('/api/v1/register', [
            'name' => $name,
            'username' => 'farmer'.uniqid(),
            'email' => 'farmer'.uniqid().'@test.dev',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'address' => 'Ali-is',
            'animal_type' => 'Goat',
            'sex' => 'F',
        ])->assertCreated();

        $farmer = User::where('name', $name)->firstOrFail();
        $beneficiary = Beneficiary::where('farmer_id', $farmer->id)->firstOrFail();
        $record = MonitoringRecord::where('beneficiary_id', $beneficiary->id)->firstOrFail();

        return [$farmer, $beneficiary, $record];
    }

    /**
     * A farmer with one of every related record the system can hold.
     *
     * @return array<string, mixed>
     */
    private function farmerWithEverything(): array
    {
        [$farmer, $beneficiary, $record] = $this->registerFarmer();

        $technician = User::factory()->create(['role' => 'technician', 'name' => 'Tech '.uniqid()]);
        $doctor = User::factory()->create(['role' => 'doctor']);

        // Assign the technician: appends to technician_assignments + notifies.
        $this->actingAs($this->admin)
            ->patchJson("/api/v1/admin/beneficiaries/{$beneficiary->id}/assign-technician", [
                'technician_id' => $technician->id,
            ])->assertOk();

        $assignment = TechnicianAssignment::where('beneficiary_id', $beneficiary->id)->firstOrFail();

        $visit = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create();

        $photo = FieldVisitPhoto::create([
            'field_visit_id' => $visit->id,
            'technician_id' => $technician->id,
            'image_path' => 'visit-photos/test.jpg',
            'capture_date' => now()->toDateString(),
            'capture_time' => now()->toTimeString(),
            'timezone_offset' => 'UTC+08:00',
            'capture_year' => now()->year,
            'capture_month' => now()->month,
            'capture_day' => now()->day,
            'capture_hour' => now()->hour,
            'capture_minute' => now()->minute,
            'capture_second' => now()->second,
        ]);

        $health = HealthRecord::factory()->forBeneficiary($beneficiary)->by($doctor)->create();
        $note = CaseNote::factory()->forBeneficiary($beneficiary)->by($doctor)->create();

        $dispersal = DispersalEvent::factory()->initial($beneficiary)->create();

        // A second monitoring record on the same household, so the delete is
        // proven to clear the entire history and not just the clicked row.
        $extraRecord = MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->by($technician)
            ->create();

        return compact(
            'farmer', 'beneficiary', 'record', 'technician', 'assignment',
            'visit', 'photo', 'health', 'note', 'dispersal', 'extraRecord',
        );
    }

    public function test_deleting_a_registration_row_soft_deletes_every_related_record(): void
    {
        $data = $this->farmerWithEverything();

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$data['record']->id}")
            ->assertNoContent();

        // The row the admin clicked AND every other row across the system.
        $this->assertSoftDeleted('monitoring_records', ['id' => $data['record']->id]);
        $this->assertSoftDeleted('monitoring_records', ['id' => $data['extraRecord']->id]);
        $this->assertSoftDeleted('beneficiaries', ['id' => $data['beneficiary']->id]);
        $this->assertSoftDeleted('users', ['id' => $data['farmer']->id]);
        $this->assertSoftDeleted('technician_assignments', ['id' => $data['assignment']->id]);
        $this->assertSoftDeleted('field_visits', ['id' => $data['visit']->id]);
        $this->assertSoftDeleted('field_visit_photos', ['id' => $data['photo']->id]);
        $this->assertSoftDeleted('health_records', ['id' => $data['health']->id]);
        $this->assertSoftDeleted('case_notes', ['id' => $data['note']->id]);
        $this->assertSoftDeleted('dispersal_events', ['id' => $data['dispersal']->id]);

        // Notifications are the deliberate exception (unique dedupe_key):
        // they are removed outright, not soft-deleted.
        $this->assertDatabaseMissing('user_notifications', ['beneficiary_id' => $data['beneficiary']->id]);
        $this->assertDatabaseMissing('user_notifications', ['user_id' => $data['farmer']->id]);
    }

    public function test_a_deleted_farmer_cannot_log_in(): void
    {
        [$farmer, , $record] = $this->registerFarmer();

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$record->id}")
            ->assertNoContent();

        $this->postJson('/api/v1/login', [
            'identifier' => $farmer->email,
            'password' => 'Sup3r-Secret!',
        ])->assertUnprocessable();
    }

    public function test_a_soft_deleted_farmer_disappears_from_every_list_and_report(): void
    {
        $data = $this->farmerWithEverything();
        $name = $data['beneficiary']->name_of_farmer;

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$data['record']->id}")
            ->assertNoContent();

        // Admin views.
        $this->actingAs($this->admin)->getJson('/api/v1/monitoring-records')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->admin)->getJson('/api/v1/beneficiaries')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->admin)->getJson('/api/v1/admin/beneficiaries')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->admin)->getJson('/api/v1/field-visits')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->admin)->getJson('/api/v1/health-records')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->admin)->getJson('/api/v1/case-notes')->assertOk()->assertJsonCount(0, 'data');

        // Derived views whose numbers come from raw correlated subqueries.
        $this->actingAs($this->admin)->getJson('/api/v1/vaccination-schedule')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->admin)->getJson('/api/v1/animal-health')->assertOk()->assertJsonCount(0, 'data');

        // Technician scope.
        $this->actingAs($data['technician'])->getJson('/api/v1/monitoring-records')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($data['technician'])->getJson('/api/v1/beneficiaries')->assertOk()->assertJsonCount(0, 'data');

        // Reporting aggregates.
        $report = $this->actingAs($this->admin)->getJson('/api/v1/admin/report')->assertOk();
        $report->assertJsonPath('data.program.households', 0);
        $report->assertJsonPath('data.program.animals', 0);
        $this->assertSame([], $report->json('data.per_barangay'));

        // Search and the notification feed must not name the farmer.
        $search = $this->actingAs($this->admin)->getJson('/api/v1/search?q='.urlencode($name))->assertOk();
        $search->assertJsonPath('data.total', 0);

        $feed = $this->actingAs($this->admin)->getJson('/api/v1/notifications')->assertOk();
        $this->assertStringNotContainsString($name, $feed->getContent());
    }

    public function test_the_beneficiaries_delete_endpoint_removes_the_whole_farmer(): void
    {
        $data = $this->farmerWithEverything();

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/beneficiaries/{$data['beneficiary']->id}")
            ->assertNoContent();

        $this->assertSoftDeleted('beneficiaries', ['id' => $data['beneficiary']->id]);
        $this->assertSoftDeleted('users', ['id' => $data['farmer']->id]);
        $this->assertSoftDeleted('monitoring_records', ['id' => $data['record']->id]);
        $this->assertSoftDeleted('field_visits', ['id' => $data['visit']->id]);
        $this->assertSoftDeleted('health_records', ['id' => $data['health']->id]);
        $this->assertSoftDeleted('case_notes', ['id' => $data['note']->id]);
    }

    public function test_a_farmer_owning_several_households_keeps_their_account(): void
    {
        [$farmer, $beneficiary, $record] = $this->registerFarmer();

        // A second household under the same login. Deleting one must not
        // remove the account, only the household that was deleted.
        $other = Beneficiary::factory()->forFarmer($farmer)->create();

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$record->id}")
            ->assertNoContent();

        $this->assertSoftDeleted('beneficiaries', ['id' => $beneficiary->id]);
        $this->assertDatabaseHas('users', ['id' => $farmer->id, 'deleted_at' => null]);
        $this->assertDatabaseHas('beneficiaries', ['id' => $other->id, 'deleted_at' => null]);
    }

    public function test_deleting_an_ordinary_visit_row_does_not_delete_the_farmer(): void
    {
        [$farmer, $beneficiary] = $this->registerFarmer();
        $technician = User::factory()->create(['role' => 'technician']);

        // A normal technician visit — registration_status defaults to `none`.
        $visitRecord = MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->by($technician)
            ->create();

        $this->actingAs($this->admin)
            ->deleteJson("/api/v1/monitoring-records/{$visitRecord->id}")
            ->assertNoContent();

        $this->assertSoftDeleted('monitoring_records', ['id' => $visitRecord->id]);
        $this->assertDatabaseHas('beneficiaries', ['id' => $beneficiary->id, 'deleted_at' => null]);
        $this->assertDatabaseHas('users', ['id' => $farmer->id, 'deleted_at' => null]);
    }
}
