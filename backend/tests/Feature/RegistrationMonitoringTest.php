<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The registration → monitoring-record pipeline: a farmer who registers with
 * dispersal details gets a monitoring record automatically, in the same
 * transaction, flagged `new` until midnight (accepted or not).
 */
class RegistrationMonitoringTest extends TestCase
{
    use RefreshDatabase;

    private function payload(array $overrides = []): array
    {
        return [
            'name' => 'Kylle Farmer',
            'username' => 'kylle'.uniqid(),
            'email' => 'kylle'.uniqid().'@test.dev',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'address' => 'Ali-is',
            'animal_type' => 'Goat',
            'sex' => 'F',
            ...$overrides,
        ];
    }

    public function test_registration_creates_a_new_monitoring_record_transactionally(): void
    {
        $response =         $this->postJson('/api/v1/register', $this->payload());

        $response->assertCreated();

        $user = User::where('email', 'like', 'kylle%@test.dev')->latest('id')->first();
        $beneficiary = Beneficiary::where('farmer_id', $user->id)->first();

        $this->assertNotNull($beneficiary);

        $record = MonitoringRecord::where('beneficiary_id', $beneficiary->id)->first();
        $this->assertNotNull($record, 'monitoring record must exist right after registration');
        $this->assertSame(MonitoringRecord::REGISTRATION_NEW, $record->registration_status);
        $this->assertNull($record->technician_id);
        $this->assertNotNull($record->registered_at);
        // Countdown is set at creation: midnight, app timezone.
        $this->assertNotNull($record->status_expires_at);
        $this->assertTrue($record->status_expires_at->isTomorrow() || $record->status_expires_at->isMidnight());

        $this->assertSame(1, MonitoringRecord::where('beneficiary_id', $beneficiary->id)->count());
    }

    public function test_registration_without_dispersal_still_creates_one_record(): void
    {
        // Registration always provisions a beneficiary (pre-existing behavior:
        // location_source defaults survive the payload filter), so every new
        // farmer lands on the monitoring table — exactly one record, flagged
        // new, even with no dispersal details filled in.
        $this->postJson('/api/v1/register', $this->payload([
            'address' => null,
            'animal_type' => null,
            'sex' => null,
        ]))->assertCreated();

        $this->assertSame(1, MonitoringRecord::count());
        $this->assertSame('new', MonitoringRecord::first()->registration_status);
    }

    public function test_a_failed_registration_leaves_no_partial_rows(): void
    {
        // Duplicate username → the user create fails inside the transaction;
        // neither user, beneficiary, nor monitoring record may survive.
        $payload = $this->payload();
        $this->postJson('/api/v1/register', $payload)->assertCreated();

        $countBefore = MonitoringRecord::count();

        $this->postJson('/api/v1/register', $payload)->assertUnprocessable();

        $this->assertSame($countBefore, MonitoringRecord::count());
    }

    public function test_admin_can_accept_a_new_record(): void
    {
        $this->postJson('/api/v1/register', $this->payload())->assertCreated();
        $record = MonitoringRecord::latest('id')->first();

        $response = $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->patchJson("/api/v1/monitoring-records/{$record->id}/accept");

        $response->assertOk()
            ->assertJsonPath('data.registration_status', 'accepted')
            ->assertJsonPath('data.is_new', true); // still "New" until midnight

        $record->refresh();
        $this->assertSame(MonitoringRecord::REGISTRATION_ACCEPTED, $record->registration_status);
        $this->assertNotNull($record->accepted_at);
        $this->assertTrue($record->status_expires_at->isTomorrow() || $record->status_expires_at->isMidnight());
    }

    public function test_non_admins_cannot_accept(): void
    {
        $this->postJson('/api/v1/register', $this->payload())->assertCreated();
        $record = MonitoringRecord::latest('id')->first();

        $this->actingAs(User::factory()->create(['role' => 'technician']))
            ->patchJson("/api/v1/monitoring-records/{$record->id}/accept")
            ->assertForbidden();

        $this->actingAs(User::factory()->create(['role' => 'doctor']))
            ->patchJson("/api/v1/monitoring-records/{$record->id}/accept")
            ->assertForbidden();

        $record->refresh();
        $this->assertSame(MonitoringRecord::REGISTRATION_NEW, $record->registration_status);
    }

    public function test_ordinary_records_cannot_be_accepted(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();
        $record = MonitoringRecord::factory()->by($technician)->for($beneficiary, 'beneficiary')->create();

        $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->patchJson("/api/v1/monitoring-records/{$record->id}/accept")
            ->assertForbidden();
    }
}
