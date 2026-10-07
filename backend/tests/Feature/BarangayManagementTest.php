<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\Beneficiary;
use App\Models\Purok;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BarangayManagementTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    public function test_a_guest_cannot_manage_reference_data(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.57, 'longitude' => 122.88]);

        $this->postJson('/api/v1/admin/barangays', ['name' => 'X', 'latitude' => 1, 'longitude' => 1])
            ->assertUnauthorized();
        $this->postJson("/api/v1/admin/barangays/{$barangay->id}/puroks", ['name' => 'Purok 1'])
            ->assertUnauthorized();
    }

    public function test_only_admins_can_manage_reference_data(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'technician']))
            ->postJson('/api/v1/admin/barangays', ['name' => 'X', 'latitude' => 1, 'longitude' => 1])
            ->assertForbidden();
    }

    public function test_an_admin_can_add_a_barangay(): void
    {
        $this->actingAs($this->admin())
            ->postJson('/api/v1/admin/barangays', [
                'name' => 'New Coverage',
                'latitude' => 9.5,
                'longitude' => 122.8,
            ])
            ->assertStatus(201)
            ->assertJsonPath('data.barangay.name', 'New Coverage');

        $this->assertDatabaseHas('barangays', ['name' => 'New Coverage']);
    }

    public function test_a_duplicate_barangay_name_is_rejected(): void
    {
        Barangay::create(['name' => 'Dawis', 'latitude' => 9.57, 'longitude' => 122.88]);

        $this->actingAs($this->admin())
            ->postJson('/api/v1/admin/barangays', [
                'name' => 'Dawis',
                'latitude' => 9.5,
                'longitude' => 122.8,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name']);
    }

    public function test_a_barangay_can_be_recentered_but_not_renamed(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.57, 'longitude' => 122.88]);

        $this->actingAs($this->admin())
            ->patchJson("/api/v1/admin/barangays/{$barangay->id}", [
                // A rename attempt is simply not a rule — it is dropped, not
                // applied. The name is immutable by design.
                'name' => 'Renamed',
                'latitude' => 9.6,
            ])
            ->assertOk()
            ->assertJsonPath('data.barangay.name', 'Dawis')
            ->assertJsonPath('data.barangay.latitude', 9.6);

        $this->assertDatabaseHas('barangays', ['id' => $barangay->id, 'name' => 'Dawis']);
    }

    public function test_an_admin_can_add_a_purok_to_a_barangay(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.57, 'longitude' => 122.88]);

        $this->actingAs($this->admin())
            ->postJson("/api/v1/admin/barangays/{$barangay->id}/puroks", [
                'name' => 'Purok 3',
            ])
            ->assertStatus(201)
            ->assertJsonPath('data.purok.name', 'Purok 3')
            ->assertJsonPath('data.purok.is_placeholder', false);

        $this->assertDatabaseHas('puroks', ['barangay_id' => $barangay->id, 'name' => 'Purok 3']);
    }

    public function test_a_duplicate_purok_name_within_a_barangay_is_rejected(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.57, 'longitude' => 122.88]);
        Purok::create(['barangay_id' => $barangay->id, 'name' => 'Purok 1']);

        // Same name in ANOTHER barangay is fine; the unique scope is per barangay.
        $other = Barangay::create(['name' => 'Ali-is', 'latitude' => 9.53, 'longitude' => 122.89]);
        $this->actingAs($this->admin())
            ->postJson("/api/v1/admin/barangays/{$other->id}/puroks", ['name' => 'Purok 1'])
            ->assertStatus(201);

        $this->actingAs($this->admin())
            ->postJson("/api/v1/admin/barangays/{$barangay->id}/puroks", ['name' => 'Purok 1'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name']);
    }

    public function test_a_purok_can_be_renamed(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.57, 'longitude' => 122.88]);
        $purok = Purok::create([
            'barangay_id' => $barangay->id,
            'name' => 'Purok 1 (placeholder)',
            'is_placeholder' => true,
        ]);

        $this->actingAs($this->admin())
            ->patchJson("/api/v1/admin/puroks/{$purok->id}", [
                'name' => 'Sitio Proper',
                'is_placeholder' => false,
            ])
            ->assertOk()
            ->assertJsonPath('data.purok.name', 'Sitio Proper')
            ->assertJsonPath('data.purok.is_placeholder', false);

        $this->assertDatabaseMissing('puroks', ['name' => 'Purok 1 (placeholder)']);
    }

    public function test_an_unused_purok_can_be_deleted(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.57, 'longitude' => 122.88]);
        $purok = Purok::create(['barangay_id' => $barangay->id, 'name' => 'Purok 1']);

        $this->actingAs($this->admin())
            ->deleteJson("/api/v1/admin/puroks/{$purok->id}")
            ->assertOk();

        $this->assertDatabaseMissing('puroks', ['id' => $purok->id]);
    }

    public function test_a_purok_with_households_cannot_be_deleted(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.57, 'longitude' => 122.88]);
        $purok = Purok::create(['barangay_id' => $barangay->id, 'name' => 'Purok 1']);
        Beneficiary::factory()->create(['purok_id' => $purok->id]);

        $this->actingAs($this->admin())
            ->deleteJson("/api/v1/admin/puroks/{$purok->id}")
            ->assertStatus(409);

        $this->assertDatabaseHas('puroks', ['id' => $purok->id]);
    }

    public function test_the_settings_screen_serves_the_updated_reference_data(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.57, 'longitude' => 122.88]);
        Purok::create(['barangay_id' => $barangay->id, 'name' => 'Purok 1']);

        $this->actingAs($this->admin())
            ->getJson('/api/v1/admin/settings')
            ->assertOk()
            ->assertJsonPath('data.barangays.0.name', 'Dawis')
            ->assertJsonPath('data.barangays.0.puroks.0.name', 'Purok 1');
    }
}
