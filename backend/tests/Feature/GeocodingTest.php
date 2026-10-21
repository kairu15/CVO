<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\User;
use App\Support\Barangays;
use Database\Seeders\BarangaySeeder;
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

        $admin = User::factory()->create(['role' => 'admin']);

        $response = $this->actingAs($admin)
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

        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
            ->getJson('/api/v1/geocode?address=Nowhere%20XYZ')
            ->assertOk()
            ->assertJsonPath('data', null);
    }

    /**
     * The pin picker needs the lookup before anything is saved — including on
     * the admin Beneficiaries form's own first render — so the endpoint is
     * session-free: it only proxies cached, throttled Nominatim lookups and
     * reveals nothing user-specific.
     */
    public function test_geocode_is_public_for_the_pin_picker(): void
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

        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
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

        $admin = User::factory()->create(['role' => 'admin']);

        // A covered barangay always gets a pin: OSM miss -> barangay centroid.
        $this->actingAs($admin)
            ->postJson('/api/v1/beneficiaries', [
                'name_of_farmer' => 'Geo Farmer',
                'address' => 'Dawis',
                'animal_type' => 'Goat',
                'sex' => 'F',
            ])
            ->assertCreated()
            ->assertJsonPath('data.latitude', 9.5766683)
            ->assertJsonPath('data.longitude', 122.8819134);
    }

    public function test_address_update_re_resolves_coordinates(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([
                ['lat' => '9.4712', 'lon' => '122.8319', 'display_name' => 'Dawis, Bayawan'],
            ]),
        ]);

        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create();

        $this->actingAs($admin)
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

        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
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
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)
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

        $admin = User::factory()->create(['role' => 'admin']);

        // Loose spelling from the client is stored canonically.
        $this->actingAs($admin)
            ->postJson('/api/v1/beneficiaries', [
                'name_of_farmer' => 'Geo Farmer',
                'address' => 'banaybanay',
                'animal_type' => 'Goat',
                'sex' => 'F',
            ])
            ->assertCreated()
            ->assertJsonPath('data.address', 'Banaybanay');
    }

    public function test_an_enrolment_rejects_an_uncovered_barangay(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)->postJson('/api/v1/beneficiaries', [
            'name_of_farmer' => 'Juan Dela Cruz',
            'address' => 'Somewhere Else',
            'animal_type' => 'Carabao',
            'sex' => 'F',
        ])->assertUnprocessable()->assertJsonValidationErrors(['address']);
    }

    public function test_an_enrolment_accepts_a_covered_barangay(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([]),
        ]);

        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)->postJson('/api/v1/beneficiaries', [
            'name_of_farmer' => 'Juan Dela Cruz',
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
        // The endpoint serves the seeded reference table.
        $this->seed(BarangaySeeder::class);

        $this->getJson('/api/v1/barangays')
            ->assertOk()
            ->assertJsonCount(28, 'data')
            ->assertJsonPath('data.0.name', 'Ali-is');
    }

    public function test_normalize_matches_loose_spellings(): void
    {
        $this->assertSame('Banaybanay', Barangays::normalize('banaybanay'));
        $this->assertSame('Banaybanay', Barangays::normalize('  BANAY BANAY '));
        $this->assertSame('Dawis', Barangays::normalize('dawis'));
        $this->assertSame('Nowhere XYZ', Barangays::normalize('Nowhere XYZ'));
    }

    /**
     * Report sheets write the barangay however the encoder did: "Manduao" for
     * "Mandu-ao", "Villasol" for "Villasol (Bato)". Both have to resolve, or
     * the household is imported without coordinates and never gets a map pin
     * even though its address names a covered barangay.
     */
    public function test_normalize_matches_hyphenated_and_qualified_barangay_names(): void
    {
        $this->assertSame('Mandu-ao', Barangays::normalize('Manduao'));
        $this->assertSame('Mandu-ao', Barangays::normalize('mandu ao'));
        $this->assertSame('Villasol (Bato)', Barangays::normalize('Villasol'));
        $this->assertSame('Villasol (Bato)', Barangays::normalize('villasol (bato)'));
        $this->assertSame('Ubos (Poblacion)', Barangays::normalize('Ubos'));

        // Dropping the qualifier must not merge a qualified entry into the
        // plain one — "Poblacion" is its own barangay.
        $this->assertSame('Poblacion', Barangays::normalize('Poblacion'));
        $this->assertSame('Suba (Poblacion)', Barangays::normalize('Suba'));

        $this->assertTrue(Barangays::isCovered('Manduao'));
        $this->assertTrue(Barangays::isCovered('Villasol'));
    }
}
