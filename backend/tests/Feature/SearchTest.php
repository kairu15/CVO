<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SearchTest extends TestCase
{
    use RefreshDatabase;

    /** Search as $user for $term, returning the `data` payload. */
    private function searchAs(User $user, string $term): array
    {
        return $this->actingAs($user)
            ->getJson('/api/v1/search?q='.urlencode($term))
            ->assertOk()
            ->json('data');
    }

    /** The `type` values of the groups in a search body. */
    private function groupTypes(array $body): array
    {
        return array_column($body['groups'], 'type');
    }

    public function test_a_guest_cannot_search(): void
    {
        $this->getJson('/api/v1/search?q=nena')->assertUnauthorized();
    }

    public function test_a_short_query_is_rejected(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->getJson('/api/v1/search?q=n')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['q']);
    }

    public function test_a_missing_query_is_rejected(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->getJson('/api/v1/search')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['q']);
    }

    public function test_a_surrounding_whitespace_query_is_trimmed_before_validation(): void
    {
        // " x " trims to "x" — one character, so validation must reject it:
        // trimming happens before the rules run, not after.
        $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->getJson('/api/v1/search?q='.urlencode('  x  '))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['q']);
    }

    public function test_admin_finds_a_household_by_farmer_name(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create(['name_of_farmer' => 'Aling Nena']);

        $body = $this->searchAs($admin, 'nena');

        $this->assertSame(['beneficiary'], $this->groupTypes($body));
        $this->assertSame(1, $body['total']);
        $this->assertSame($beneficiary->id, $body['groups'][0]['results'][0]['id']);
        $this->assertSame('Aling Nena', $body['groups'][0]['results'][0]['title']);
    }

    public function test_households_can_be_found_by_barangay_and_by_animal(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Beneficiary::factory()->create(['name_of_farmer' => 'Someone Else', 'address' => 'Banaybanay']);

        $byBarangay = $this->searchAs($admin, 'banay');
        $this->assertSame(['beneficiary'], $this->groupTypes($byBarangay));

        Beneficiary::factory()->create(['name_of_farmer' => 'Third Household', 'animal_type' => 'Swine']);
        $byAnimal = $this->searchAs($admin, 'swine');
        $this->assertSame(['beneficiary'], $this->groupTypes($byAnimal));
    }

    public function test_a_name_match_is_ranked_above_an_address_match(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);

        // Both match "banay": one in the farmer name, one only in the address.
        Beneficiary::factory()->create(['name_of_farmer' => 'Banay Farms Inc', 'address' => 'Dawis']);
        Beneficiary::factory()->create(['name_of_farmer' => 'Unrelated Household', 'address' => 'Banaybanay']);

        $body = $this->searchAs($admin, 'banay');

        $results = $body['groups'][0]['results'];
        $this->assertSame('Banay Farms Inc', $results[0]['title']);
    }

    public function test_a_technician_only_searches_their_assigned_households(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $assigned = Beneficiary::factory()->assignedTo($technician)->create(['name_of_farmer' => 'My Household']);
        Beneficiary::factory()->create(['name_of_farmer' => 'My Household']);

        $body = $this->searchAs($technician, 'my household');

        $this->assertSame(1, $body['total']);
        $this->assertSame($assigned->id, $body['groups'][0]['results'][0]['id']);
    }

    public function test_monitoring_visits_match_through_remarks_and_household(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $beneficiary = Beneficiary::factory()->create(['name_of_farmer' => 'Unrelated Name']);

        MonitoringRecord::factory()
            ->for($beneficiary, 'beneficiary')
            ->create(['remarks' => 'Treated for parasites']);

        $body = $this->searchAs($admin, 'parasites');

        $this->assertSame(['monitoring-record'], $this->groupTypes($body));
        $this->assertSame('/dashboard/admin/monitoring', $body['groups'][0]['results'][0]['link']);
    }

    public function test_a_technician_searching_a_remark_finds_only_their_own_visits(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $mine = Beneficiary::factory()->assignedTo($technician)->create();
        $theirs = Beneficiary::factory()->create();

        MonitoringRecord::factory()->for($mine, 'beneficiary')->create(['remarks' => 'Follow up soon']);
        MonitoringRecord::factory()->for($theirs, 'beneficiary')->create(['remarks' => 'Follow up soon']);

        $body = $this->searchAs($technician, 'follow up');

        $this->assertSame(1, $body['total']);
        $this->assertSame($mine->id, $body['groups'][0]['results'][0]['id']);
    }

    public function test_accounts_group_is_admin_and_doctor_only(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        User::factory()->create(['name' => 'Aling Nena Staff', 'email' => 'nena@example.com']);

        $adminBody = $this->searchAs($admin, 'nena');
        $this->assertContains('account', $this->groupTypes($adminBody));

        // Same term as a technician: the account group must not appear at all.
        $technician = User::factory()->create(['role' => 'technician']);
        $technicianBody = $this->searchAs($technician, 'nena');
        $this->assertNotContains('account', $this->groupTypes($technicianBody));
    }

    public function test_an_account_search_never_lists_the_caller(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'name' => 'Ada Admin']);

        $body = $this->searchAs($admin, 'ada');

        // The only match would be the caller themself; the group is absent.
        $this->assertSame([], $body['groups']);
        $this->assertSame(0, $body['total']);
    }

    public function test_an_account_result_links_to_user_management(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        User::factory()->create(['role' => 'technician', 'name' => 'Jun Technician']);

        $body = $this->searchAs($admin, 'jun');

        $accountGroup = collect($body['groups'])->firstWhere('type', 'account');
        $this->assertSame('/dashboard/admin/users', $accountGroup['results'][0]['link']);
    }

    public function test_a_household_result_links_to_the_lineage_page_for_staff(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor']);
        $beneficiary = Beneficiary::factory()->create(['name_of_farmer' => 'Lineage Target']);

        $body = $this->searchAs($doctor, 'lineage');

        $this->assertSame(
            "/dashboard/doctor/beneficiaries/{$beneficiary->id}/lineage",
            $body['groups'][0]['results'][0]['link'],
        );
    }

    public function test_a_household_result_links_to_the_lineage_page_for_every_role(): void
    {
        // Every account is staff now: a household result always lands on the
        // lineage screen, never a farmer dashboard (that role is gone).
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create(['name_of_farmer' => 'My Own Household']);

        $body = $this->searchAs($technician, 'my own');

        $this->assertSame(
            "/dashboard/technician/beneficiaries/{$beneficiary->id}/lineage",
            $body['groups'][0]['results'][0]['link'],
        );
    }

    public function test_an_empty_result_set_is_a_200_with_no_groups(): void
    {
        $body = $this->searchAs(User::factory()->create(['role' => 'admin']), 'zzzznothing');

        $this->assertSame([], $body['groups']);
        $this->assertSame(0, $body['total']);
    }
}
