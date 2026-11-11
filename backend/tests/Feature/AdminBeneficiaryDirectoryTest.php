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
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($technician)
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

    public function test_the_barangay_filter_narrows_the_directory_and_totals_cover_the_whole_set(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Beneficiary::factory()->count(3)->create(['address' => 'Dawis']);
        Beneficiary::factory()->count(2)->create(['address' => 'Banay Banay']);

        // The group badge is the true count, not the rows on this page.
        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=50')
            ->assertOk()
            ->assertJsonPath('group_totals.Dawis', 3)
            ->assertJsonPath('group_totals.Banay Banay', 2);

        // The dropdown that used to be silently ignored now filters.
        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?barangay=Banay%20Banay&per_page=50')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('group_totals.Banay Banay', 2);
    }

    public function test_search_covers_rsbsa_ear_tag_and_the_assigned_technician(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician', 'name' => 'Jun Bisaya']);

        Beneficiary::factory()->create([
            'name_of_farmer' => 'Nena Reyes',
            'rsbsa_number' => 'RSBSA-777',
            'ear_tag_number' => 'TAG-9',
            'address' => 'Dawis',
            'technician_id' => $technician->id,
        ]);
        Beneficiary::factory()->create(['name_of_farmer' => 'Other Farmer', 'address' => 'Tayawan']);

        foreach (['RSBSA-777', 'TAG-9', 'Jun Bisaya'] as $term) {
            $this->actingAs($admin)
                ->getJson('/api/v1/admin/beneficiaries?per_page=50&search='.urlencode($term))
                ->assertOk()
                ->assertJsonCount(1, 'data')
                ->assertJsonPath('data.0.name_of_farmer', 'Nena Reyes');
        }
    }

    public function test_assignment_monitoring_and_data_gap_filters_run_per_household(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);

        $assigned = Beneficiary::factory()->create([
            'technician_id' => $technician->id,
            'rsbsa_number' => 'RSBSA-1',
            'latitude' => 9.1,
            'longitude' => 122.8,
        ]);
        $assigned->monitoringRecords()->create(['date_monitored' => now()->toDateString()]);

        $unassigned = Beneficiary::factory()->create([
            'technician_id' => null,
            'rsbsa_number' => null,
            'latitude' => null,
            'longitude' => null,
        ]);

        $overdue = Beneficiary::factory()->create([
            'technician_id' => null,
            'rsbsa_number' => 'RSBSA-3',
            'latitude' => 9.2,
            'longitude' => 122.9,
        ]);
        $overdue->monitoringRecords()->create(['date_monitored' => now()->subDays(120)->toDateString()]);

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=50&assignment=unassigned')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=50&assignment='.$technician->id)
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $assigned->id);

        // Never = no dated visit at all; overdue = no visit in 60 days (which
        // deliberately includes the never-visited households).
        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=50&monitoring=never')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $unassigned->id);

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=50&monitoring=overdue')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=50&missing=rsbsa')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $unassigned->id);

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=50&missing=location')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $unassigned->id);
    }

    public function test_the_row_reports_its_visit_count_and_last_dated_visit(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create();
        $beneficiary->monitoringRecords()->create(['date_monitored' => '2026-02-03']);
        $beneficiary->monitoringRecords()->create(['date_monitored' => '2026-03-04']);

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries?per_page=50')
            ->assertOk()
            ->assertJsonPath('data.0.monitoring_records_count', 2)
            ->assertJsonPath('data.0.last_monitored_at', '2026-03-04');
    }

    public function test_the_summary_reports_the_oversight_figures(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);

        $assigned = Beneficiary::factory()->create([
            'technician_id' => $technician->id,
            'rsbsa_number' => 'RSBSA-1',
            'latitude' => 9.1,
            'longitude' => 122.8,
        ]);
        $assigned->monitoringRecords()->create(['date_monitored' => now()->toDateString()]);

        Beneficiary::factory()->create([
            'technician_id' => null,
            'rsbsa_number' => null,
            'latitude' => null,
            'longitude' => null,
        ]);

        Beneficiary::factory()->create([
            'technician_id' => null,
            'rsbsa_number' => 'RSBSA-3',
            'latitude' => 9.2,
            'longitude' => 122.9,
        ]);

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries/summary')
            ->assertOk()
            ->assertJsonPath('data.households', 3)
            ->assertJsonPath('data.unassigned', 2)
            ->assertJsonPath('data.never_monitored', 2)
            // Overdue includes the never-visited households.
            ->assertJsonPath('data.overdue', 2)
            ->assertJsonPath('data.overdue_days', 60)
            ->assertJsonPath('data.missing_rsbsa', 1)
            ->assertJsonPath('data.without_location', 1);
    }

    public function test_the_id_list_matches_the_active_filters(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $dawis = Beneficiary::factory()->count(2)->create(['address' => 'Dawis']);
        Beneficiary::factory()->create(['address' => 'Tayawan']);

        $response = $this->actingAs($admin)
            ->getJson('/api/v1/admin/beneficiaries/ids?barangay=Dawis')
            ->assertOk()
            ->assertJsonPath('total', 2);

        // The directory orders by address then name, so compare the set.
        $this->assertEqualsCanonicalizing($dawis->pluck('id')->all(), $response->json('data'));
    }

    public function test_the_export_streams_the_filtered_directory_as_csv(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Beneficiary::factory()->create([
            'name_of_farmer' => 'Nena Reyes',
            'address' => 'Dawis',
            'rsbsa_number' => 'RSBSA-42',
        ]);
        Beneficiary::factory()->create(['name_of_farmer' => 'Other Farmer', 'address' => 'Tayawan']);

        $response = $this->actingAs($admin)->get('/api/v1/admin/beneficiaries/export?barangay=Dawis');

        $response->assertOk();
        $response->assertHeader('content-type', 'text/csv; charset=UTF-8');

        $csv = $response->streamedContent();

        $this->assertStringContainsString('Name of Farmer', $csv);
        $this->assertStringContainsString('Nena Reyes', $csv);
        $this->assertStringContainsString('RSBSA-42', $csv);
        $this->assertStringNotContainsString('Other Farmer', $csv);
    }

    public function test_enrolment_warns_about_a_possible_duplicate_and_proceeds_when_confirmed(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Beneficiary::factory()->create([
            'name_of_farmer' => 'Nena Reyes',
            'address' => 'Dawis',
            'rsbsa_number' => 'RSBSA-42',
        ]);

        $payload = [
            'name_of_farmer' => 'Nena Reyes',
            'rsbsa_number' => 'RSBSA-42',
            'animal_type' => 'Carabao',
            'sex' => 'F',
            'address' => 'Dawis',
            'location_source' => 'manual',
        ];

        $this->actingAs($admin)
            ->postJson('/api/v1/beneficiaries', $payload)
            ->assertStatus(409)
            ->assertJsonPath('duplicates.0.name_of_farmer', 'Nena Reyes');

        $this->actingAs($admin)
            ->postJson('/api/v1/beneficiaries', [...$payload, 'confirm_duplicate' => true])
            ->assertCreated();
    }
}
