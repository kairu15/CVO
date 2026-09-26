<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\User;
use App\Support\Barangays;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Every registered household must land on the dispersal map: when the
 * browser supplies a GPS/map-pin fix it is stored as-is, and when it does
 * not the server pins the beneficiary at the covered barangay's
 * authoritative center — a coordinate-less registration used to produce a
 * row that no map could ever place.
 */
class RegistrationPinTest extends TestCase
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

    public function test_registration_without_a_browser_pin_falls_back_to_the_barangay_center(): void
    {
        $this->postJson('/api/v1/register', $this->payload())->assertCreated();

        $user = User::where('email', 'like', 'kylle%@test.dev')->latest('id')->first();
        $beneficiary = Beneficiary::where('farmer_id', $user->id)->first();

        $this->assertNotNull($beneficiary);

        $center = Barangays::centerFor('Ali-is');

        $this->assertSame($center[0], (float) $beneficiary->latitude);
        $this->assertSame($center[1], (float) $beneficiary->longitude);
        $this->assertSame('manual', $beneficiary->location_source);
    }

    public function test_registration_keeps_the_browser_captured_pin_when_present(): void
    {
        $this->postJson('/api/v1/register', $this->payload([
            'latitude' => 9.540123,
            'longitude' => 122.890456,
            'location_source' => 'gps',
        ]))->assertCreated();

        $user = User::where('email', 'like', 'kylle%@test.dev')->latest('id')->first();
        $beneficiary = Beneficiary::where('farmer_id', $user->id)->first();

        $this->assertSame(9.540123, (float) $beneficiary->latitude);
        $this->assertSame(122.890456, (float) $beneficiary->longitude);
        $this->assertSame('gps', $beneficiary->location_source);
    }

    public function test_registration_with_loose_barangay_spelling_still_gets_a_pin(): void
    {
        // The request normalizes the address before it reaches the service,
        // but the fallback must not depend on which form arrives.
        $this->postJson('/api/v1/register', $this->payload([
            'address' => 'banay banay',
        ]))->assertCreated();

        $beneficiary = Beneficiary::latest('id')->first();

        $center = Barangays::centerFor('Banaybanay');

        $this->assertSame('Banaybanay', $beneficiary->address);
        $this->assertSame($center[0], (float) $beneficiary->latitude);
        $this->assertSame($center[1], (float) $beneficiary->longitude);
    }
}
