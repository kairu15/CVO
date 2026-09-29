<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Support\Barangays;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The backfill exists because imported households whose address the matcher
 * did not recognise were stored coordinate-less, so they never drew a pin on
 * the dispersal map. Only addresses that genuinely resolve to a covered
 * barangay are filled in — nothing is guessed onto the map.
 */
class BackfillBeneficiaryCoordinatesTest extends TestCase
{
    use RefreshDatabase;

    private function unpinned(string $address, string $name = 'Juan Dela Cruz'): Beneficiary
    {
        return Beneficiary::factory()->create([
            'name_of_farmer' => $name,
            'address' => $address,
            'latitude' => null,
            'longitude' => null,
        ]);
    }

    public function test_it_pins_a_household_whose_short_spelling_names_a_covered_barangay(): void
    {
        $beneficiary = $this->unpinned('Manduao');

        $this->artisan('beneficiaries:backfill-coordinates')->assertSuccessful();

        $center = Barangays::centerFor('Mandu-ao');
        $beneficiary->refresh();

        $this->assertSame($center[0], (float) $beneficiary->latitude);
        $this->assertSame($center[1], (float) $beneficiary->longitude);
    }

    public function test_it_pins_a_household_whose_address_drops_the_barangay_qualifier(): void
    {
        $beneficiary = $this->unpinned('Villasol');

        $this->artisan('beneficiaries:backfill-coordinates')->assertSuccessful();

        $center = Barangays::centerFor('Villasol (Bato)');
        $beneficiary->refresh();

        $this->assertSame($center[0], (float) $beneficiary->latitude);
        $this->assertSame($center[1], (float) $beneficiary->longitude);
    }

    public function test_it_leaves_an_address_that_names_no_covered_barangay_alone(): void
    {
        $unlisted = $this->unpinned('Unlisted', 'Maria Santos');

        $this->artisan('beneficiaries:backfill-coordinates')->assertSuccessful();

        $unlisted->refresh();

        $this->assertNull($unlisted->latitude);
        $this->assertNull($unlisted->longitude);
    }

    public function test_it_never_moves_a_household_that_already_has_a_pin(): void
    {
        $beneficiary = Beneficiary::factory()->create([
            'latitude' => 9.1234,
            'longitude' => 122.4321,
        ]);

        $this->artisan('beneficiaries:backfill-coordinates')->assertSuccessful();

        $beneficiary->refresh();

        $this->assertSame(9.1234, (float) $beneficiary->latitude);
        $this->assertSame(122.4321, (float) $beneficiary->longitude);
    }

    public function test_a_dry_run_reports_without_writing(): void
    {
        $beneficiary = $this->unpinned('Villasol');

        $this->artisan('beneficiaries:backfill-coordinates --dry-run')->assertSuccessful();

        $this->assertNull($beneficiary->refresh()->latitude);
    }
}
