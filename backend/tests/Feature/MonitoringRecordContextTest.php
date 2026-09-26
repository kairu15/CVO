<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\FieldVisitPhoto;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The admin Monitoring Records table's Technician + Timestamp columns:
 * the beneficiary's assigned technician and the most recent field-visit
 * photo's capture timestamp, riding on the monitoring-records response.
 */
class MonitoringRecordContextTest extends TestCase
{
    use RefreshDatabase;

    public function test_index_includes_the_assigned_technician_and_latest_photo(): void
    {
        $assigned = User::factory()->create(['role' => 'technician', 'name' => 'Jun Tech']);
        $beneficiary = Beneficiary::factory()->assignedTo($assigned)->create();
        MonitoringRecord::factory()->by($assigned)->for($beneficiary, 'beneficiary')->create();

        $response = $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->getJson('/api/v1/monitoring-records');

        $response->assertOk()
            ->assertJsonPath('data.0.assigned_technician.name', 'Jun Tech')
            ->assertJsonPath('data.0.has_photo', false)
            ->assertJsonPath('data.0.latest_field_visit_photo', null);
    }

    public function test_unassigned_beneficiaries_report_a_null_assigned_technician(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->create(); // no technician_id
        MonitoringRecord::factory()->by($technician)->for($beneficiary, 'beneficiary')->create();

        $response = $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->getJson('/api/v1/monitoring-records');

        $response->assertOk()->assertJsonPath('data.0.assigned_technician', null);
    }

    public function test_the_latest_photo_is_the_most_recent_capture_across_all_visits(): void
    {
        Storage::fake('public');

        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();
        MonitoringRecord::factory()->by($technician)->for($beneficiary, 'beneficiary')->create();

        $older = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'visited_on' => '2026-09-01',
        ]);
        $newer = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'visited_on' => '2026-09-20',
        ]);

        $this->photo($older, ['capture_date' => '2026-09-01', 'capture_time' => '15:00:00', 'capture_day' => 1]);
        $newest = $this->photo($newer, ['capture_date' => '2026-09-18', 'capture_time' => '08:30:00', 'capture_day' => 18]);

        $response = $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->getJson('/api/v1/monitoring-records');

        $response->assertOk()
            ->assertJsonPath('data.0.has_photo', true)
            ->assertJsonPath('data.0.latest_field_visit_photo.id', $newest->id)
            ->assertJsonPath('data.0.latest_field_visit_photo.capture_date', '2026-09-18');

        // The older photo is NOT the one exposed, even though its visit is
        // not the newest by id — capture time decides, explicitly.
        $this->assertNotSame(
            '2026-09-01',
            $response->json('data.0.latest_field_visit_photo.capture_date'),
        );
    }

    public function test_capture_date_then_time_then_id_break_ties(): void
    {
        Storage::fake('public');

        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();
        MonitoringRecord::factory()->by($technician)->for($beneficiary, 'beneficiary')->create();

        $visit = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create();

        // The photo endpoint replaces a visit's photo on retake, so a same-
        // timestamp tie (three rows, distinct ids) is written to the model
        // directly. Date and time are identical: the highest id must win.
        $rows = collect([0, 0, 0])->map(fn () => FieldVisitPhoto::create([
            'field_visit_id' => $visit->id,
            'technician_id' => $technician->id,
            'image_path' => 'field-visits/'.$visit->id.'/tie-'.uniqid().'.jpg',
            'capture_date' => '2026-09-25',
            'capture_time' => '09:00:00',
            'timezone_offset' => 'UTC+08:00',
            'capture_year' => 2026,
            'capture_month' => 9,
            'capture_day' => 25,
            'capture_hour' => 9,
            'capture_minute' => 0,
            'capture_second' => 0,
            'location_source' => 'none',
        ]));

        $expectedId = $rows->last()->id;

        $response = $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->getJson('/api/v1/monitoring-records');

        $response->assertOk()
            ->assertJsonPath('data.0.latest_field_visit_photo.id', $expectedId);
    }

    public function test_technicians_receive_the_same_columns_for_their_own_rows(): void
    {
        Storage::fake('public');

        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();
        MonitoringRecord::factory()->by($technician)->for($beneficiary, 'beneficiary')->create();

        $visit = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create();
        $photo = $this->photo($visit, []);

        $this->actingAs($technician)->getJson('/api/v1/monitoring-records')
            ->assertOk()
            ->assertJsonPath('data.0.assigned_technician.id', $technician->id)
            ->assertJsonPath('data.0.latest_field_visit_photo.id', $photo->id);
    }

    /**
     * Attach a photo to a visit through the real endpoint (validation,
     * storage, metadata columns all exercised).
     *
     * @param  array<string, mixed>  $overrides
     */
    private function photo(FieldVisit $visit, array $overrides): \App\Models\FieldVisitPhoto
    {
        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", [
                'image' => \Illuminate\Http\UploadedFile::fake()->image('shot.jpg'),
                'capture_date' => '2026-09-25',
                'capture_time' => '11:45:32',
                'timezone_offset' => 'UTC+08:00',
                'capture_year' => 2026,
                'capture_month' => 9,
                'capture_day' => 25,
                'capture_hour' => 11,
                'capture_minute' => 45,
                'capture_second' => 32,
                'location_source' => 'none',
                ...$overrides,
            ])->assertCreated();

        return $visit->photos()->latest('id')->first();
    }
}
