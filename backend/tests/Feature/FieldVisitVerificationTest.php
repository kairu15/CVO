<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\User;
use App\Services\FieldVisitVerificationService;
use App\Services\SettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Feature 1 — on-site visit verification.
 *
 * The maths is asserted with KNOWN coordinates (0.001° of latitude is
 * ~111.2 m), the precedence rules are asserted state by state, and every
 * write path the brief calls out — save, note, adopt-location, report count,
 * threshold change — is exercised through the API exactly as the SPA drives
 * it.
 */
class FieldVisitVerificationTest extends TestCase
{
    use RefreshDatabase;

    /** A point in Bayawan City used as the registered pin. */
    private const BASE_LAT = 9.6000;

    private const BASE_LNG = 123.2000;

    /** ~111.2 m north of the base point (0.001° of latitude). */
    private const NORTH_LAT = 9.6010;

    private function service(): FieldVisitVerificationService
    {
        return app(FieldVisitVerificationService::class);
    }

    private function beneficiaryWithPin(float $lat = self::BASE_LAT, float $lng = self::BASE_LNG): Beneficiary
    {
        $technician = User::factory()->create(['role' => 'technician']);

        return Beneficiary::factory()->assignedTo($technician)->create([
            'latitude' => $lat,
            'longitude' => $lng,
        ]);
    }

    // ------------------------------------------------------------------ maths

    public function test_same_point_is_on_site(): void
    {
        $result = $this->service()->evaluate(self::BASE_LAT, self::BASE_LNG, 5.0, self::BASE_LAT, self::BASE_LNG, 100);

        $this->assertSame('on_site', $result['status']);
        $this->assertSame(0, $result['distance_m']);
    }

    public function test_111m_away_is_off_site_against_a_100m_threshold(): void
    {
        $result = $this->service()->evaluate(self::NORTH_LAT, self::BASE_LNG, 5.0, self::BASE_LAT, self::BASE_LNG, 100);

        $this->assertSame('off_site', $result['status']);
        $this->assertGreaterThan(105, $result['distance_m']);
        $this->assertLessThan(120, $result['distance_m']);
    }

    public function test_same_point_is_off_site_against_a_tighter_threshold(): void
    {
        // 0.0005° ≈ 55.6 m: inside a 100 m circle, outside a 50 m one.
        $result = $this->service()->evaluate(9.6005, self::BASE_LNG, 5.0, self::BASE_LAT, self::BASE_LNG, 50);

        $this->assertSame('off_site', $result['status']);
        $this->assertGreaterThan(50, $result['distance_m']);
        $this->assertLessThan(60, $result['distance_m']);
    }

    public function test_accuracy_wider_than_the_threshold_is_low_accuracy_not_off_site(): void
    {
        // Clearly outside the circle, but the fix itself is fuzzier than the
        // circle: the verdict must be "cannot judge", not "was elsewhere".
        $result = $this->service()->evaluate(self::NORTH_LAT, self::BASE_LNG, 150.0, self::BASE_LAT, self::BASE_LNG, 100);

        $this->assertSame('low_accuracy', $result['status']);
        $this->assertNotNull($result['distance_m']);
    }

    public function test_accuracy_equal_to_the_threshold_is_not_low_accuracy(): void
    {
        $result = $this->service()->evaluate(self::NORTH_LAT, self::BASE_LNG, 100.0, self::BASE_LAT, self::BASE_LNG, 100);

        $this->assertSame('off_site', $result['status']);
    }

    public function test_missing_reference_pin_is_no_reference_location(): void
    {
        $result = $this->service()->evaluate(self::BASE_LAT, self::BASE_LNG, 5.0, null, null, 100);

        $this->assertSame('no_reference_location', $result['status']);
        $this->assertNull($result['distance_m']);
    }

    public function test_missing_fix_is_no_gps_even_without_a_reference_pin(): void
    {
        $result = $this->service()->evaluate(null, null, null, null, null, 100);

        $this->assertSame('no_gps', $result['status']);
        $this->assertNull($result['distance_m']);
    }

    // ------------------------------------------------------------ persistence

    public function test_saving_a_visit_stores_the_server_side_verdict(): void
    {
        $beneficiary = $this->beneficiaryWithPin();
        $technician = $beneficiary->technician;

        $response = $this->actingAs($technician)->postJson('/api/v1/field-visits', [
            'beneficiary_id' => $beneficiary->id,
            'visited_on' => now()->toDateString(),
            'purpose' => 'routine-monitoring',
            'latitude' => self::BASE_LAT,
            'longitude' => self::BASE_LNG,
            'has_photo' => true,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.verification_status', 'on_site')
            ->assertJsonPath('data.distance_m', 0);

        $this->assertDatabaseHas('field_visits', [
            'id' => $response->json('data.id'),
            'verification_status' => 'on_site',
        ]);

        // The verdict's derivation is in the audit trail.
        $this->assertDatabaseHas('activity_logs', ['action' => 'field_visit_verification']);
    }

    public function test_off_site_verdict_is_stored_and_a_justification_can_be_added(): void
    {
        $beneficiary = $this->beneficiaryWithPin();
        $technician = $beneficiary->technician;

        $visit = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'latitude' => self::NORTH_LAT,
            'longitude' => self::BASE_LNG,
        ]);

        $this->service()->refresh($visit);
        $this->assertSame('off_site', $visit->fresh()->verification_status);

        // The justification never blocks saving — it annotates the verdict.
        $this->actingAs($technician)
            ->patchJson("/api/v1/field-visits/{$visit->id}/verification-note", ['note' => 'Met at alternate site'])
            ->assertOk()
            ->assertJsonPath('data.verification_note', 'Met at alternate site');

        $this->assertDatabaseHas('field_visits', [
            'id' => $visit->id,
            'verification_note' => 'Met at alternate site',
        ]);
        $this->assertDatabaseHas('activity_logs', ['action' => 'field_visit_verification_note']);
    }

    public function test_another_technicians_visit_cannot_be_annotated(): void
    {
        $owner = User::factory()->create(['role' => 'technician']);
        $other = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($owner)->create();
        $visit = FieldVisit::factory()->forBeneficiary($beneficiary)->by($owner)->create();

        $this->actingAs($other)
            ->patchJson("/api/v1/field-visits/{$visit->id}/verification-note", ['note' => 'nope'])
            ->assertNotFound();
    }

    public function test_off_site_needs_review_filter_is_server_side(): void
    {
        $beneficiary = $this->beneficiaryWithPin();
        $technician = $beneficiary->technician;
        $admin = User::factory()->create(['role' => 'admin']);

        $onSite = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'latitude' => self::BASE_LAT, 'longitude' => self::BASE_LNG,
        ]);
        $offSite = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'latitude' => self::NORTH_LAT, 'longitude' => self::BASE_LNG,
        ]);
        $noFix = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->withoutLocation()->create();

        foreach ([$onSite, $offSite, $noFix] as $visit) {
            $this->service()->refresh($visit);
        }

        $response = $this->actingAs($admin)
            ->getJson('/api/v1/field-visits?verification=review')
            ->assertOk();

        $ids = collect($response->json('data'))->pluck('id');

        $this->assertTrue($ids->contains($offSite->id));
        $this->assertFalse($ids->contains($onSite->id));
        // no_gps is ordinary, not a discrepancy — it stays out of the bucket.
        $this->assertFalse($ids->contains($noFix->id));

        $this->actingAs($admin)
            ->getJson('/api/v1/field-visits?verification=on_site')
            ->assertOk()
            ->assertJsonPath('data.0.id', $onSite->id);

        $this->actingAs($admin)
            ->getJson('/api/v1/field-visits?verification=bogus')
            ->assertStatus(422);
    }

    // ------------------------------------------------------- adopt-a-location

    public function test_admin_can_adopt_a_visits_location_for_an_unpinned_household(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create([
            'latitude' => null,
            'longitude' => null,
        ]);
        $visit = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'latitude' => self::BASE_LAT,
            'longitude' => self::BASE_LNG,
        ]);
        $this->service()->refresh($visit);
        $this->assertSame('no_reference_location', $visit->fresh()->verification_status);

        $this->actingAs($admin)
            ->patchJson("/api/v1/beneficiaries/{$beneficiary->id}/location", [
                'latitude' => self::BASE_LAT,
                'longitude' => self::BASE_LNG,
                'field_visit_id' => $visit->id,
            ])
            ->assertOk()
            ->assertJsonPath('data.latitude', self::BASE_LAT)
            ->assertJsonPath('data.location_source', 'gps');

        // The pin now exists, so every verdict for the household re-derives.
        $this->assertSame('on_site', $visit->fresh()->verification_status);

        // The adoption itself is in the audit trail (the model's diff row).
        $this->assertDatabaseHas('activity_logs', [
            'action' => 'beneficiary_updated',
            'target_type' => 'Beneficiary',
            'target_id' => $beneficiary->id,
        ]);
    }

    public function test_adoption_is_refused_when_the_household_already_has_a_pin(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = $this->beneficiaryWithPin();
        $visit = FieldVisit::factory()->forBeneficiary($beneficiary)->create([
            'latitude' => self::NORTH_LAT, 'longitude' => self::BASE_LNG,
        ]);

        $this->actingAs($admin)
            ->patchJson("/api/v1/beneficiaries/{$beneficiary->id}/location", [
                'latitude' => self::NORTH_LAT,
                'longitude' => self::BASE_LNG,
                'field_visit_id' => $visit->id,
            ])
            ->assertStatus(422);
    }

    public function test_a_technician_cannot_adopt_a_location(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create(['latitude' => null, 'longitude' => null]);
        $visit = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'latitude' => self::BASE_LAT, 'longitude' => self::BASE_LNG,
        ]);

        $this->actingAs($technician)
            ->patchJson("/api/v1/beneficiaries/{$beneficiary->id}/location", [
                'latitude' => self::BASE_LAT,
                'longitude' => self::BASE_LNG,
                'field_visit_id' => $visit->id,
            ])
            ->assertForbidden();
    }

    // ----------------------------------------------------------- thresholds

    public function test_the_threshold_is_an_admin_setting_the_verdict_follows(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->patchJson('/api/v1/admin/settings', ['onsite_threshold_m' => 300])
            ->assertOk();

        $this->assertSame(300, app(SettingsService::class)->onsiteThresholdM());

        // 0.002° ≈ 222 m: off site at the shipped 100 m, on site at 300 m.
        $result = $this->service()->evaluate(self::NORTH_LAT, self::BASE_LNG, null, self::BASE_LAT, self::BASE_LNG);
        $this->assertSame('on_site', $result['status']);

        $this->actingAs($admin)
            ->getJson('/api/v1/admin/settings')
            ->assertOk()
            ->assertJsonPath('data.verification.onsite_threshold_m', 300);
    }

    // --------------------------------------------------------------- report

    public function test_report_summary_counts_the_review_bucket(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $doctor = User::factory()->create(['role' => 'doctor']);
        $beneficiary = $this->beneficiaryWithPin();
        $technician = $beneficiary->technician;

        $onSite = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'latitude' => self::BASE_LAT, 'longitude' => self::BASE_LNG,
        ]);
        $offSite = FieldVisit::factory()->forBeneficiary($beneficiary)->by($technician)->create([
            'latitude' => self::NORTH_LAT, 'longitude' => self::BASE_LNG,
        ]);

        foreach ([$onSite, $offSite] as $visit) {
            $this->service()->refresh($visit);
        }

        $response = $this->actingAs($admin)->getJson('/api/v1/admin/report/verification')->assertOk();

        $this->assertSame(1, $response->json('data.counts.on_site'));
        $this->assertSame(1, $response->json('data.counts.off_site'));
        $this->assertSame(1, $response->json('data.review_count'));
        $this->assertSame(2, $response->json('data.total'));
        $this->assertSame(100, $response->json('data.threshold_m'));

        // Reporting stays behind view_reports (admin-only by seed).
        $this->actingAs($doctor)->getJson('/api/v1/admin/report/verification')->assertForbidden();
    }

    public function test_options_expose_the_threshold_to_the_field_form(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($technician)
            ->getJson('/api/v1/field-visits/options')
            ->assertOk()
            ->assertJsonPath('data.onsite_threshold_m', 100);
    }
}
