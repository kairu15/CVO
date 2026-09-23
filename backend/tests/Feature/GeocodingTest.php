<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\User;
use App\Support\Barangays;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class GeocodingTest extends TestCase
{
    use RefreshDatabase;

    public function test_geocode_endpoint_returns_coordinates_for_a_known_address(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([
                ['lat' => '9.5538', 'lon' => '122.8229', 'display_name' => 'Banaybanay, Bayawan, Negros Oriental'],
            ]),
        ]);

        $farmer = User::factory()->create(['role' => 'farmer']);

        $response = $this->actingAs($farmer)
            ->getJson('/api/v1/geocode?address=Banay%20Banay')
            ->assertOk()
            ->assertJsonPath('data.lat', 9.5538)
            ->assertJsonPath('data.lng', 122.8229);

        // The resolved display name comes back for the picker's status line.
        $this->assertStringContainsString(
            'Bayawan',
            (string) data_get($response->json(), 'data.display_name', ''),
        );
    }

    public function test_geocode_endpoint_returns_null_data_for_unknown_address(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([]),
        ]);

        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($farmer)
            ->getJson('/api/v1/geocode?address=Nowhere%20XYZ')
            ->assertOk()
            ->assertJsonPath('data', null);
    }

    /**
     * The register page is public, so the endpoint is too — it only proxies
     * cached, throttled Nominatim lookups and reveals nothing user-specific.
     */
    public function test_geocode_is_public_for_the_registration_form(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([
                ['lat' => '9.5538', 'lon' => '122.8229', 'display_name' => 'Banaybanay, Bayawan'],
            ]),
        ]);

        $this->getJson('/api/v1/geocode?address=Banay%20Banay')
            ->assertOk()
            ->assertJsonPath('data.lat', 9.5538);
    }

    public function test_beneficiary_creation_falls_back_to_geocoded_coordinates(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([
                ['lat' => '9.5538', 'lon' => '122.8229', 'display_name' => 'Banaybanay, Bayawan'],
            ]),
        ]);

        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($farmer)
            ->postJson('/api/v1/beneficiaries', [
                'name_of_farmer' => 'Geo Farmer',
                'address' => 'Banay Banay',
                'animal_type' => 'Goat',
                'sex' => 'F',
                // no latitude/longitude — geocoding fills them
            ])
            ->assertCreated()
            ->assertJsonPath('data.latitude', 9.5538)
            ->assertJsonPath('data.longitude', 122.8229);
    }

    public function test_osm_miss_falls_back_to_the_barangay_centroid(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([]),
        ]);

        $farmer = User::factory()->create(['role' => 'farmer']);

        // A covered barangay always gets a pin: OSM miss -> barangay centroid.
        $this->actingAs($farmer)
            ->postJson('/api/v1/beneficiaries', [
                'name_of_farmer' => 'Geo Farmer',
                'address' => 'Dawis',
                'animal_type' => 'Goat',
                'sex' => 'F',
            ])
            ->assertCreated()
            ->assertJsonPath('data.latitude', 9.4712)
            ->assertJsonPath('data.longitude', 122.8319);
    }

    public function test_address_update_re_resolves_coordinates(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([
                ['lat' => '9.4712', 'lon' => '122.8319', 'display_name' => 'Dawis, Bayawan'],
            ]),
        ]);

        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = Beneficiary::factory()->forFarmer($farmer)->create();

        $this->actingAs($farmer)
            ->putJson("/api/v1/beneficiaries/{$beneficiary->id}", [
                'address' => 'Dawis',
            ])
            ->assertOk()
            ->assertJsonPath('data.latitude', 9.4712);
    }

    public function test_explicit_coordinates_are_not_overridden_by_geocoding(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([
                ['lat' => '9.5538', 'lon' => '122.8229', 'display_name' => 'Wrong place'],
            ]),
        ]);

        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($farmer)
            ->postJson('/api/v1/beneficiaries', [
                'name_of_farmer' => 'Field Fix',
                'address' => 'Banay Banay',
                'animal_type' => 'Goat',
                'sex' => 'F',
                // GPS pin from the field wins over the address lookup
                'latitude' => 9.4,
                'longitude' => 122.8,
            ])
            ->assertCreated()
            ->assertJsonPath('data.latitude', 9.4)
            ->assertJsonPath('data.longitude', 122.8);
    }

    public function test_address_must_name_a_covered_barangay(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($farmer)
            ->postJson('/api/v1/beneficiaries', [
                'name_of_farmer' => 'Geo Farmer',
                'address' => 'Wrong Province Village',
                'animal_type' => 'Goat',
                'sex' => 'F',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['address']);
    }

    public function test_address_is_normalized_to_the_canonical_barangay_spelling(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([]),
        ]);

        $farmer = User::factory()->create(['role' => 'farmer']);

        // Loose spelling from the client is stored canonically.
        $this->actingAs($farmer)
            ->postJson('/api/v1/beneficiaries', [
                'name_of_farmer' => 'Geo Farmer',
                'address' => 'banaybanay',
                'animal_type' => 'Goat',
                'sex' => 'F',
            ])
            ->assertCreated()
            ->assertJsonPath('data.address', 'Banay Banay');
    }

    public function test_registration_rejects_uncovered_barangay(): void
    {
        $this->postJson('/api/v1/register', [
            'name' => 'Juan Dela Cruz',
            'username' => 'juan2',
            'email' => 'juan2@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'address' => 'Somewhere Else',
            'animal_type' => 'Carabao',
            'sex' => 'F',
        ])->assertUnprocessable()->assertJsonValidationErrors(['address']);
    }

    public function test_registration_accepts_a_covered_barangay(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([]),
        ]);

        $this->postJson('/api/v1/register', [
            'name' => 'Juan Dela Cruz',
            'username' => 'juan3',
            'email' => 'juan3@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'address' => 'Tayawan',
            'animal_type' => 'Carabao',
            'sex' => 'F',
        ])->assertCreated();

        $this->assertDatabaseHas('beneficiaries', [
            'name_of_farmer' => 'Juan Dela Cruz',
            'address' => 'Tayawan',
        ]);
    }

    public function test_barangays_endpoint_lists_the_coverage(): void
    {
        $this->getJson('/api/v1/barangays')
            ->assertOk()
            ->assertJsonPath('data.1', 'Banay Banay');
    }

    public function test_normalize_matches_loose_spellings(): void
    {
        $this->assertSame('Banay Banay', Barangays::normalize('banaybanay'));
        $this->assertSame('Banay Banay', Barangays::normalize('  BANAY BANAY '));
        $this->assertSame('Dawis', Barangays::normalize('dawis'));
        $this->assertSame('Nowhere XYZ', Barangays::normalize('Nowhere XYZ'));
    }
}
