<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Midnight expiry: records whose status_expires_at has passed flip to `old`,
 * whether they were accepted or not (the admin chose auto-expiry for `new`
 * as well). Not-yet-expired records are left alone.
 */
class ExpireRegistrationRecordsTest extends TestCase
{
    use RefreshDatabase;

    private function record(array $attributes): MonitoringRecord
    {
        $beneficiary = Beneficiary::factory()->create();

        return MonitoringRecord::create([
            'beneficiary_id' => $beneficiary->id,
            'technician_id' => null,
            'registration_status' => 'new',
            'registered_at' => now(),
            'status_expires_at' => now()->addDay()->startOfDay(),
            ...$attributes,
        ]);
    }

    public function test_expired_accepted_records_flip_to_old(): void
    {
        $expired = $this->record([
            'registration_status' => 'accepted',
            'accepted_at' => now()->subDay(),
            'status_expires_at' => now()->subHour(),
        ]);

        $this->artisan('monitoring:expire-registrations')->assertSuccessful();

        $this->assertSame('old', $expired->refresh()->registration_status);
        $this->assertNull($expired->status_expires_at);
        // accepted_at survives: it records that an admin did act.
        $this->assertNotNull($expired->accepted_at);
    }

    public function test_expired_new_records_flip_to_old_too(): void
    {
        $neverAccepted = $this->record([
            'registration_status' => 'new',
            'status_expires_at' => now()->subMinute(),
        ]);

        $this->artisan('monitoring:expire-registrations')->assertSuccessful();

        $this->assertSame('old', $neverAccepted->refresh()->registration_status);
    }

    public function test_not_yet_expired_records_are_left_alone(): void
    {
        $stillNew = $this->record([
            'registration_status' => 'new',
            'status_expires_at' => now()->addHour(),
        ]);

        $stillAccepted = $this->record([
            'registration_status' => 'accepted',
            'accepted_at' => now(),
            'status_expires_at' => now()->addHour(),
        ]);

        $this->artisan('monitoring:expire-registrations')->assertSuccessful();

        $this->assertSame('new', $stillNew->refresh()->registration_status);
        $this->assertSame('accepted', $stillAccepted->refresh()->registration_status);
    }

    public function test_ordinary_records_without_a_countdown_are_untouched(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();
        $ordinary = MonitoringRecord::factory()->by($technician)->for($beneficiary, 'beneficiary')->create();

        $this->artisan('monitoring:expire-registrations')->assertSuccessful();

        $this->assertSame('none', $ordinary->refresh()->registration_status);
    }

    public function test_already_old_records_are_not_reprocessed(): void
    {
        $old = $this->record([
            'registration_status' => 'old',
            'status_expires_at' => null,
        ]);

        $this->artisan('monitoring:expire-registrations')->assertSuccessful();

        $this->assertSame('old', $old->refresh()->registration_status);
    }
}
