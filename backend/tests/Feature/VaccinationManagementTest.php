<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Beneficiary;
use App\Models\User;
use App\Models\Vaccination;
use App\Models\VaccinationScheduleOverride;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class VaccinationManagementTest extends TestCase
{
    use RefreshDatabase;

    private User $technician;

    private User $admin;

    private Beneficiary $beneficiary;

    protected function setUp(): void
    {
        parent::setUp();

        $this->technician = User::factory()->create(['role' => 'technician']);
        $this->admin = User::factory()->create(['role' => 'admin']);
        $this->beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create([
            'name_of_farmer' => 'Nena Cruz',
            'address' => 'Dawis',
            'animal_type' => 'Carabao',
        ]);
    }

    private function payload(array $overrides = []): array
    {
        return [
            'beneficiary_id' => $this->beneficiary->id,
            'vaccine_name' => 'Hemorrhagic Septicemia',
            'administered_on' => now()->subDays(3)->toDateString(),
            'quantity' => 2,
            'batch_number' => 'LOT-1234',
            'protocol_days' => 10,
            'next_due_on' => now()->addDays(7)->toDateString(),
            'notes' => 'Two of five animals covered.',
            ...$overrides,
        ];
    }

    public function test_a_technician_records_history_and_the_next_due_override_together(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/vaccinations', $this->payload())
            ->assertCreated()
            ->assertJsonPath('data.vaccine_name', 'Hemorrhagic Septicemia')
            ->assertJsonPath('data.quantity', 2)
            ->assertJsonPath('data.technician_id', $this->technician->id)
            ->assertJsonPath('data.name_of_farmer', 'Nena Cruz')
            ->assertJsonPath('data.next_due_on', now()->addDays(7)->toDateString());

        $this->assertDatabaseHas('vaccinations', [
            'beneficiary_id' => $this->beneficiary->id,
            'technician_id' => $this->technician->id,
            'vaccine_name' => 'Hemorrhagic Septicemia',
            'quantity' => 2,
        ]);

        $this->assertDatabaseHas('vaccination_schedule_overrides', [
            'beneficiary_id' => $this->beneficiary->id,
            'next_due_on' => now()->addDays(7)->toDateString(),
            'updated_by' => $this->technician->id,
        ]);

        $this->assertDatabaseHas('activity_logs', [
            'action' => 'vaccination_created',
            'target_type' => 'Vaccination',
            'actor_id' => $this->technician->id,
        ]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/vaccination-schedule')
            ->assertOk()
            ->assertJsonPath('data.0.vaccine_name', 'Hemorrhagic Septicemia')
            ->assertJsonPath('data.0.history_count', 1)
            ->assertJsonPath('data.0.next_due_date', now()->addDays(7)->toDateString())
            ->assertJsonPath('data.0.status', 'due-soon');
    }

    public function test_the_protocol_computes_the_next_due_date_when_it_is_omitted(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/vaccinations', $this->payload([
                'administered_on' => '2026-01-01',
                'protocol_days' => 14,
                'next_due_on' => null,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.next_due_on', '2026-01-15');

        $this->assertDatabaseHas('vaccination_schedule_overrides', [
            'beneficiary_id' => $this->beneficiary->id,
            'next_due_on' => '2026-01-15',
        ]);
    }

    public function test_vaccine_history_is_preserved_and_returned_newest_first(): void
    {
        $older = Vaccination::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'vaccine_name' => 'Anti-Rabies',
            'administered_on' => now()->subDays(60)->toDateString(),
        ]);
        $newer = Vaccination::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'vaccine_name' => 'Hog Cholera',
            'administered_on' => now()->subDays(2)->toDateString(),
        ]);

        $this->actingAs($this->technician)
            ->getJson("/api/v1/beneficiaries/{$this->beneficiary->id}/vaccinations")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $newer->id)
            ->assertJsonPath('data.0.vaccine_name', 'Hog Cholera')
            ->assertJsonPath('data.1.id', $older->id)
            ->assertJsonPath('data.0.technician.name', $this->technician->name);
    }

    public function test_rescheduling_changes_only_the_override(): void
    {
        $vaccination = Vaccination::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'administered_on' => now()->subDays(30)->toDateString(),
            'next_due_on' => now()->subDay()->toDateString(),
        ]);

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/vaccination-schedule/{$this->beneficiary->id}/reschedule", [
                'next_due_on' => now()->addWeek()->toDateString(),
                'reason' => 'Vaccine delivery delayed',
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'due-soon')
            ->assertJsonPath('data.next_due_date', now()->addWeek()->toDateString());

        $this->assertDatabaseHas('vaccination_schedule_overrides', [
            'beneficiary_id' => $this->beneficiary->id,
            'reason' => 'Vaccine delivery delayed',
        ]);

        // The administration row is unchanged.
        $this->assertSame(
            now()->subDay()->toDateString(),
            $vaccination->refresh()->next_due_on->toDateString(),
        );
        $this->assertDatabaseHas('activity_logs', [
            'action' => 'vaccination_rescheduled',
            'actor_id' => $this->technician->id,
        ]);
    }

    public function test_summary_search_and_status_filters_share_the_schedule_rules(): void
    {
        Vaccination::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create([
            'vaccine_name' => 'Anti-Rabies',
            'administered_on' => now()->subDays(60)->toDateString(),
            'protocol_days' => 30,
            'next_due_on' => now()->subDay()->toDateString(),
        ]);

        VaccinationScheduleOverride::create([
            'beneficiary_id' => $this->beneficiary->id,
            'next_due_on' => now()->addDays(90)->toDateString(),
            'updated_by' => $this->technician->id,
        ]);

        $other = Beneficiary::factory()->create(['name_of_farmer' => 'Other Farmer']);
        Vaccination::factory()->by($this->technician)->forBeneficiary($other)->create([
            'vaccine_name' => 'Hog Cholera',
            'administered_on' => now()->toDateString(),
            'protocol_days' => 30,
            'next_due_on' => now()->addDays(3)->toDateString(),
        ]);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/vaccination-schedule/summary')
            ->assertOk()
            ->assertJsonPath('data.total_scheduled', 2)
            ->assertJsonPath('data.completed', 1)
            ->assertJsonPath('data.upcoming', 1)
            ->assertJsonPath('data.overdue', 0);

        $this->actingAs($this->technician)
            ->getJson('/api/v1/vaccination-schedule?search=Anti-Rabies')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $this->beneficiary->id);

        // The saved override moved this household out of overdue, even though
        // the stored vaccination's own next_due_on is in the past.
        $this->actingAs($this->technician)
            ->getJson('/api/v1/vaccination-schedule?status=overdue')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->actingAs($this->technician)
            ->getJson('/api/v1/vaccination-schedule?status=scheduled')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_only_technicians_with_the_clinical_capability_can_record(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/v1/vaccinations', $this->payload())
            ->assertForbidden();

        $this->actingAs($this->technician)
            ->postJson('/api/v1/vaccinations', $this->payload())
            ->assertCreated();
    }

    public function test_recording_validates_identity_dates_and_quantity(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/vaccinations', $this->payload([
                'administered_on' => now()->addDay()->toDateString(),
                'quantity' => 0,
                'next_due_on' => now()->subDay()->toDateString(),
                'protocol_days' => 0,
            ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'administered_on',
                'quantity',
                'next_due_on',
                'protocol_days',
            ]);
    }

    public function test_a_supporting_photo_is_private_and_owner_scoped(): void
    {
        Storage::fake('secure');

        $vaccination = Vaccination::factory()->by($this->technician)->forBeneficiary($this->beneficiary)->create();

        $response = $this->actingAs($this->technician)
            ->post("/api/v1/vaccinations/{$vaccination->id}/photo", [
                'image' => UploadedFile::fake()->image('dose.jpg')->size(300),
            ])
            ->assertOk()
            ->assertJsonPath('data.has_photo', true);

        $this->assertStringContainsString('expiration=', $response->json('data.photo_url'));
        Storage::disk('secure')->assertExists($vaccination->refresh()->photo_path);

        $colleague = User::factory()->create(['role' => 'technician']);
        $this->actingAs($colleague)
            ->post("/api/v1/vaccinations/{$vaccination->id}/photo", [
                'image' => UploadedFile::fake()->image('dose.jpg')->size(300),
            ])
            ->assertForbidden();
    }

    public function test_a_technician_can_read_citywide_history_but_guests_cannot(): void
    {
        $unassigned = Beneficiary::factory()->create();
        Vaccination::factory()->by($this->technician)->forBeneficiary($unassigned)->create();

        $this->actingAs($this->technician)
            ->getJson("/api/v1/beneficiaries/{$unassigned->id}/vaccinations")
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->getJson('/api/v1/vaccinations')->assertStatus(405);
    }

    public function test_activity_log_actions_are_recognised(): void
    {
        foreach ([
            'vaccination_created',
            'vaccination_updated',
            'vaccination_deleted',
            'vaccination_rescheduled',
            'vaccination_photo_uploaded',
        ] as $action) {
            $this->assertContains($action, ActivityLog::ACTIONS);
        }
    }
}
