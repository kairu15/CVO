<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\Purok;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The public location cascade — GET /barangays, GET /barangays/{id}/puroks —
 * and the registration-side purok validation that depends on it.
 */
class BarangayApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_barangays_are_public_and_ordered(): void
    {
        Barangay::create(['name' => 'Dawis', 'latitude' => 9.5766683, 'longitude' => 122.8819134]);
        Barangay::create(['name' => 'Ali-is', 'latitude' => 9.5325654, 'longitude' => 122.8933552]);

        $this->getJson('/api/v1/barangays')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonStructure([
                'data' => [['id', 'name', 'latitude', 'longitude']],
            ]);

        // Seeded order (by id) is the display order.
        $this->assertSame(
            Barangay::query()->orderBy('id')->pluck('name')->all(),
            collect($this->getJson('/api/v1/barangays')->json('data'))->pluck('name')->all(),
        );
    }

    public function test_puroks_are_public_and_scoped_to_their_barangay(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.5766683, 'longitude' => 122.8819134]);
        $other = Barangay::create(['name' => 'Tayawan', 'latitude' => 9.4995966, 'longitude' => 122.7398316]);

        $mine = collect([
            Purok::create(['barangay_id' => $barangay->id, 'name' => 'Purok 1 (placeholder)', 'is_placeholder' => true]),
            Purok::create(['barangay_id' => $barangay->id, 'name' => 'Purok 2 (placeholder)', 'is_placeholder' => true]),
        ]);
        Purok::create(['barangay_id' => $other->id, 'name' => 'Purok 1 (placeholder)', 'is_placeholder' => true]);

        $response = $this->getJson("/api/v1/barangays/{$barangay->id}/puroks")
            ->assertOk()
            ->assertJsonCount(2, 'data');

        // Only this barangay's puroks come back, placeholders flagged.
        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertSameCanonical($mine->pluck('id')->all(), $ids);

        $this->assertTrue(collect($response->json('data'))->every(
            fn (array $purok) => $purok['barangay_id'] === $barangay->id
                && array_key_exists('is_placeholder', $purok),
        ));
    }

    public function test_unknown_barangay_puroks_404(): void
    {
        $this->getJson('/api/v1/barangays/9999/puroks')->assertNotFound();
    }

    private function assertSameCanonical(array $expected, array $actual): void
    {
        sort($expected);
        sort($actual);
        $this->assertSame($expected, $actual);
    }

    // -------------------------------------------------------------------------
    // Registration-side validation
    // -------------------------------------------------------------------------

    private function registrationPayload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Juan Dela Cruz',
            'username' => 'juan-'.bin2hex(random_bytes(4)),
            'email' => bin2hex(random_bytes(4)).'@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'address' => 'Dawis',
            'animal_type' => 'Carabao',
            'sex' => 'F',
        ], $overrides);
    }

    public function test_registration_stores_the_resolved_barangay_and_chosen_purok(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.5766683, 'longitude' => 122.8819134]);
        $purok = Purok::create(['barangay_id' => $barangay->id, 'name' => 'Purok 2 (placeholder)', 'is_placeholder' => true]);

        $this->postJson('/api/v1/register', $this->registrationPayload([
            'purok_id' => $purok->id,
        ]))->assertCreated();

        $this->assertDatabaseHas('beneficiaries', [
            'address' => 'Dawis',
            'barangay_id' => $barangay->id,
            'purok_id' => $purok->id,
        ]);
    }

    public function test_registration_resolves_the_barangay_id_without_a_purok(): void
    {
        $barangay = Barangay::create(['name' => 'Dawis', 'latitude' => 9.5766683, 'longitude' => 122.8819134]);

        $this->postJson('/api/v1/register', $this->registrationPayload())
            ->assertCreated();

        $this->assertDatabaseHas('beneficiaries', [
            'address' => 'Dawis',
            'barangay_id' => $barangay->id,
            'purok_id' => null,
        ]);
    }

    public function test_registration_rejects_a_purok_from_another_barangay(): void
    {
        $foreign = Barangay::create(['name' => 'Tayawan', 'latitude' => 9.4995966, 'longitude' => 122.7398316]);
        $purok = Purok::create(['barangay_id' => $foreign->id, 'name' => 'Purok 1 (placeholder)', 'is_placeholder' => true]);

        $this->postJson('/api/v1/register', $this->registrationPayload([
            'purok_id' => $purok->id,
        ]))->assertUnprocessable()
            ->assertJsonValidationErrors(['purok_id']);
    }

    public function test_registration_rejects_an_unknown_purok(): void
    {
        $this->postJson('/api/v1/register', $this->registrationPayload([
            'purok_id' => 99999,
        ]))->assertUnprocessable()
            ->assertJsonValidationErrors(['purok_id']);
    }

    public function test_registration_rejects_a_purok_without_a_barangay(): void
    {
        // A purok is meaningless without the barangay it lives in — and
        // accepting it would create a beneficiary whose location cannot
        // resolve — so a stray purok_id alone is a validation error.
        $this->postJson('/api/v1/register', [
            'name' => 'Plain',
            'username' => 'plain-'.bin2hex(random_bytes(4)),
            'email' => bin2hex(random_bytes(4)).'@example.com',
            'password' => 'Sup3r-Secret!',
            'password_confirmation' => 'Sup3r-Secret!',
            'purok_id' => 99999,
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['purok_id']);

        $this->assertDatabaseMissing('beneficiaries', [
            'name_of_farmer' => 'Plain',
        ]);
    }
}
