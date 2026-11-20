<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Barangay;
use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\HealthRecord;
use App\Models\Purok;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
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

    public function test_the_profile_carries_no_farmer_section(): void
    {
        // Beneficiaries are records, not profiles: the endpoint answers with
        // the staff account's own data and (per role) staff-only sections.
        // There is no `farmer` section because there is no farmer account.
        // The technician absorbed the old doctor role's clinical work, so it
        // carries BOTH its field section and the clinical footprint.
        $technician = User::factory()->create(['role' => 'technician']);

        $this->actingAs($technician)->getJson('/api/v1/profile')
            ->assertOk()
            ->assertJsonPath('data.user.role', 'technician')
            ->assertJsonStructure([
                'data' => [
                    'user' => [
                        'id', 'name', 'username', 'email', 'phone', 'address',
                        'role', 'status', 'avatar_url', 'last_login_at', 'created_at',
                    ],
                    'technician' => ['assigned_farmers'],
                    'clinical' => ['health_records_count', 'case_notes_count'],
                ],
            ])
            ->assertJsonMissingPath('data.farmer');
    }

    public function test_the_technician_and_clinical_sections_report_existing_counts(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $technician->assignedBeneficiaries()->create([
            'name_of_farmer' => 'Rice Farmer',
            'address' => 'Dawis',
            'barangay_id' => $this->barangay->id,
            'animal_type' => 'Cow',
        ]);
        HealthRecord::factory()->by($technician)->create();
        CaseNote::factory()->count(2)->by($technician)->create();

        $this->actingAs($technician)->getJson('/api/v1/profile')
            ->assertOk()
            ->assertJsonPath('data.technician.assigned_farmers', 1)
            ->assertJsonPath('data.clinical.health_records_count', 1)
            ->assertJsonPath('data.clinical.case_notes_count', 2);

        // The administrator holds neither the field assignment nor the
        // clinical authorship, so neither section appears at all.
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin)->getJson('/api/v1/profile')
            ->assertOk()
            ->assertJsonMissingPath('data.technician')
            ->assertJsonMissingPath('data.clinical');
    }

    public function test_user_can_update_own_name_email_and_contact_details(): void
    {
        $user = User::factory()->create(['name' => 'Old Name']);
        $other = User::factory()->create();

        $this->actingAs($user)->patchJson('/api/v1/profile', [
            'name' => 'New Name',
            'email' => 'new-email@example.com',
            'phone' => '+63 912 345 6789',
            'address' => '12 Mabini Street, Dawis',
            // Role/username are not accepted inputs — silently ignored.
            'role' => 'admin',
        ])->assertOk()
            ->assertJsonPath('data.user.name', 'New Name')
            ->assertJsonPath('data.user.phone', '+63 912 345 6789')
            ->assertJsonPath('data.user.address', '12 Mabini Street, Dawis')
            ->assertJsonPath('data.user.role', $user->role);

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'name' => 'New Name',
            'email' => 'new-email@example.com',
            'phone' => '+63 912 345 6789',
            'address' => '12 Mabini Street, Dawis',
        ]);
        $this->assertDatabaseMissing('users', ['id' => $user->id, 'role' => 'admin']);
        $this->assertDatabaseHas('users', ['id' => $other->id, 'name' => $other->name]);
    }

    public function test_contact_details_are_validated(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->patchJson('/api/v1/profile', [
            'phone' => 'call me',
            'address' => str_repeat('a', 256),
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['phone', 'address']);
    }

    public function test_email_must_stay_unique(): void
    {
        $user = User::factory()->create();
        $taken = User::factory()->create();

        $this->actingAs($user)->patchJson('/api/v1/profile', [
            'email' => $taken->email,
        ])->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_household_location_fields_are_not_writable_from_the_profile(): void
    {
        // The personal `address` field belongs to the account. Household
        // location (barangay/purok/coordinates) is corrected on the admin
        // Beneficiaries screen and is not accepted here.
        $user = User::factory()->create(['role' => 'technician']);

        $this->actingAs($user)->patchJson('/api/v1/profile', [
            'purok_id' => 999,
            'latitude' => 9.57,
            'longitude' => 122.88,
        ])->assertOk();

        $this->assertNull($user->fresh()->latitude ?? null);
    }

    public function test_security_payload_lists_only_the_callers_sessions_and_activity(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $user->forceFill(['last_login_at' => now()->subHour()])->save();

        $token = $user->createToken('Field phone');
        $other->createToken('Other phone');

        foreach ([[$user, 'user-session'], [$other, 'other-session']] as [$owner, $id]) {
            DB::table('sessions')->insert([
                'id' => $id,
                'user_id' => $owner->id,
                'ip_address' => '127.0.0.1',
                'user_agent' => 'Mozilla/5.0 Chrome/120.0 Safari/537.36',
                'payload' => 'payload',
                'last_activity' => now()->timestamp,
            ]);
        }

        ActivityLog::create([
            'actor_id' => $user->id,
            'action' => 'login',
            'ip_address' => '127.0.0.1',
        ]);
        ActivityLog::create([
            'actor_id' => $other->id,
            'action' => 'login',
            'ip_address' => '127.0.0.1',
        ]);

        $response = $this->withToken($token->plainTextToken)
            ->getJson('/api/v1/profile/security')
            ->assertOk()
            ->assertJsonCount(2, 'data.sessions')
            ->assertJsonCount(1, 'data.recent_activity')
            ->assertJsonPath('data.recent_activity.0.label', 'Signed in')
            ->assertJsonFragment(['device' => 'Field phone', 'current' => true])
            ->assertJsonFragment(['device' => 'Chrome browser'])
            ->assertJsonMissing(['device' => 'Other phone']);

        $this->assertNotNull($response->json('data.last_login_at'));
    }

    public function test_the_caller_can_revoke_other_sessions_without_losing_their_own(): void
    {
        $user = User::factory()->create();
        $current = $user->createToken('This phone');
        $other = $user->createToken('Old phone');

        DB::table('sessions')->insert([
            'id' => 'old-browser',
            'user_id' => $user->id,
            'ip_address' => '127.0.0.1',
            'user_agent' => 'Mozilla/5.0',
            'payload' => 'payload',
            'last_activity' => now()->timestamp,
        ]);

        $this->withToken($current->plainTextToken)
            ->postJson('/api/v1/profile/sessions/revoke-others')
            ->assertOk()
            ->assertJsonPath('data.revoked', true);

        $this->assertDatabaseHas('personal_access_tokens', ['id' => $current->accessToken->id]);
        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $other->accessToken->id]);
        $this->assertDatabaseMissing('sessions', ['id' => 'old-browser']);
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
        Storage::fake('public'); Storage::fake('secure');
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
        // Item 8: avatars live on the private `secure` disk.
        Storage::disk('secure')->assertExists($user->refresh()->avatar_path);

        // Removing the photo deletes the stored file and clears the column.
        $path = $user->refresh()->avatar_path;
        $this->actingAs($user)->deleteJson('/api/v1/profile/avatar')->assertOk();
        $this->assertNull($user->refresh()->avatar_path);
        Storage::disk('secure')->assertMissing($path);
    }

    public function test_profile_requires_authentication(): void
    {
        $this->getJson('/api/v1/profile')->assertUnauthorized();
        $this->getJson('/api/v1/profile/security')->assertUnauthorized();
        $this->patchJson('/api/v1/profile', [])->assertUnauthorized();
        $this->postJson('/api/v1/profile/sessions/revoke-others')->assertUnauthorized();
    }
}
