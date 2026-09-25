<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\Beneficiary;
use App\Models\Purok;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The self-profile endpoints — GET/PATCH /profile, password change and the
 * avatar upload. Every test asserts the self-scoping: no user id is ever
 * accepted, the payload always lands on the caller's own account.
 */
class ProfileTest extends TestCase
{
    use RefreshDatabase;

    private Barangay $barangay;

    private Purok $purok;

    protected function setUp(): void
    {
        parent::setUp();

        $this->barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.5766683, 'longitude' => 122.8819134]);
        $this->purok = Purok::create(['barangay_id' => $this->barangay->id, 'name' => 'Purok 1']);
    }

    public function test_farmer_profile_includes_their_beneficiaries_and_location(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $farmer->beneficiaries()->create([
            'name_of_farmer' => $farmer->name,
            'address' => 'Dawis',
            'barangay_id' => $this->barangay->id,
            'purok_id' => $this->purok->id,
            'animal_type' => 'Carabao',
            'sex' => 'F',
            'location_source' => 'manual',
        ]);

        $this->actingAs($farmer)->getJson('/api/v1/profile')
            ->assertOk()
            ->assertJsonPath('data.user.email', $farmer->email)
            ->assertJsonPath('data.user.role', 'farmer')
            ->assertJsonStructure([
                'data' => [
                    'user' => ['id', 'name', 'username', 'email', 'role', 'avatar_url', 'created_at'],
                    'farmer' => ['beneficiaries' => [['barangay' => ['id', 'name'], 'purok' => ['id', 'name']]]],
                ],
            ]);
    }

    public function test_technician_and_doctor_sections_report_existing_counts(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $technician->assignedBeneficiaries()->create([
            'name_of_farmer' => 'Rice Farmer',
            'address' => 'Dawis',
            'barangay_id' => $this->barangay->id,
            'animal_type' => 'Cow',
        ]);

        $this->actingAs($technician)->getJson('/api/v1/profile')
            ->assertOk()
            ->assertJsonPath('data.technician.assigned_farmers', 1);

        $doctor = User::factory()->create(['role' => 'doctor']);

        $this->actingAs($doctor)->getJson('/api/v1/profile')
            ->assertOk()
            ->assertJsonPath('data.doctor.health_records_count', 0)
            ->assertJsonPath('data.doctor.case_notes_count', 0);
    }

    public function test_user_can_update_own_name_and_email_only(): void
    {
        $user = User::factory()->create(['name' => 'Old Name']);
        $other = User::factory()->create();

        $this->actingAs($user)->patchJson('/api/v1/profile', [
            'name' => 'New Name',
            'email' => 'new-email@example.com',
            // Role/username are not accepted inputs — silently ignored.
            'role' => 'admin',
        ])->assertOk()
            ->assertJsonPath('data.user.name', 'New Name')
            ->assertJsonPath('data.user.role', $user->role);

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'name' => 'New Name',
            'email' => 'new-email@example.com',
        ]);
        $this->assertDatabaseMissing('users', ['id' => $user->id, 'role' => 'admin']);
        $this->assertDatabaseHas('users', ['id' => $other->id, 'name' => $other->name]);
    }

    public function test_email_must_stay_unique(): void
    {
        $user = User::factory()->create();
        $taken = User::factory()->create();

        $this->actingAs($user)->patchJson('/api/v1/profile', [
            'email' => $taken->email,
        ])->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_farmer_location_update_syncs_beneficiaries(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);
        $beneficiary = $farmer->beneficiaries()->create([
            'name_of_farmer' => $farmer->name,
            'address' => 'Dawis',
            'barangay_id' => $this->barangay->id,
            'animal_type' => 'Goat',
        ]);

        $this->actingAs($farmer)->patchJson('/api/v1/profile', [
            'address' => 'Dawis',
            'purok_id' => $this->purok->id,
            'latitude' => 9.57,
            'longitude' => 122.88,
            'location_source' => 'map_pin',
        ])->assertOk();

        $this->assertDatabaseHas('beneficiaries', [
            'id' => $beneficiary->id,
            'purok_id' => $this->purok->id,
            'latitude' => 9.57,
            'location_source' => 'map_pin',
        ]);
    }

    public function test_purok_must_belong_to_the_submitted_barangay(): void
    {
        $other = Barangay::create(['name' => 'Tayawan', 'latitude' => 9.4995966, 'longitude' => 122.7398316]);
        $foreignPurok = Purok::create(['barangay_id' => $other->id, 'name' => 'Purok A']);
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($farmer)->patchJson('/api/v1/profile', [
            'address' => 'Dawis',
            'purok_id' => $foreignPurok->id,
        ])->assertUnprocessable()->assertJsonValidationErrors('purok_id');
    }

    public function test_address_must_be_a_covered_barangay(): void
    {
        $farmer = User::factory()->create(['role' => 'farmer']);

        $this->actingAs($farmer)->patchJson('/api/v1/profile', [
            'address' => 'Not A Barangay',
        ])->assertUnprocessable()->assertJsonValidationErrors('address');
    }

    public function test_password_change_requires_the_current_password(): void
    {
        $user = User::factory()->create(['password' => 'Current!Pass1']);

        $this->actingAs($user)->patchJson('/api/v1/profile/password', [
            'current_password' => 'Wrong!Pass1',
            'password' => 'NewSecret!123',
            'password_confirmation' => 'NewSecret!123',
        ])->assertUnprocessable()->assertJsonValidationErrors('current_password');

        $this->actingAs($user)->patchJson('/api/v1/profile/password', [
            'current_password' => 'Current!Pass1',
            'password' => 'weak',
            'password_confirmation' => 'weak',
        ])->assertUnprocessable()->assertJsonValidationErrors('password');

        $this->actingAs($user)->patchJson('/api/v1/profile/password', [
            'current_password' => 'Current!Pass1',
            'password' => 'NewSecret!123',
            'password_confirmation' => 'NewSecret!123',
        ])->assertNoContent();
    }

    public function test_avatar_upload_is_validated_server_side_and_scoped_to_the_caller(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $other = User::factory()->create();

        $this->actingAs($user)->postJson('/api/v1/profile/avatar', [
            'avatar' => UploadedFile::fake()->create('notes.txt', 1),
        ])->assertUnprocessable()->assertJsonValidationErrors('avatar');

        $this->actingAs($user)->postJson('/api/v1/profile/avatar', [
            'avatar' => UploadedFile::fake()->image('me.png', 120, 120),
        ])->assertOk()
            ->assertJsonPath('data.user.id', $user->id);

        $this->assertNotNull($user->refresh()->avatar_path);
        $this->assertNull($other->refresh()->avatar_path); // untouched — upload is caller-scoped
        Storage::disk('public')->assertExists($user->refresh()->avatar_path);

        // Removing the photo deletes the stored file and clears the column.
        $path = $user->refresh()->avatar_path;
        $this->actingAs($user)->deleteJson('/api/v1/profile/avatar')->assertOk();
        $this->assertNull($user->refresh()->avatar_path);
        Storage::disk('public')->assertMissing($path);
    }

    public function test_profile_requires_authentication(): void
    {
        $this->getJson('/api/v1/profile')->assertUnauthorized();
        $this->patchJson('/api/v1/profile', [])->assertUnauthorized();
    }
}
