<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * E-signature on dispersal agreements (item 7).
 *
 * The signature is a legal/audit record: a PNG captured at dispersal time,
 * stored on the private disk, attributed to the authenticated capturer, and
 * immutable once recorded.
 */
class DispersalSignatureTest extends TestCase
{
    use RefreshDatabase;

    /** A real 1x1 PNG as a data URL — the shape a canvas signature arrives in. */
    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('secure');
    }

    /** @return array{0: Beneficiary, 1: Beneficiary} [parent, recipient] */
    private function pair(): array
    {
        return [
            Beneficiary::factory()->create(),
            Beneficiary::factory()->create(),
        ];
    }

    private function payload(Beneficiary $recipient, Beneficiary $parent, array $extra = []): array
    {
        return $extra + [
            'beneficiary_id' => $recipient->id,
            'parent_beneficiary_id' => $parent->id,
            'dispersal_type' => DispersalEvent::TYPE_RE_DISPERSAL,
        ];
    }

    public function test_signature_is_stored_with_provenance(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        [$parent, $recipient] = $this->pair();

        $response = $this->actingAs($admin)
            ->postJson('/api/v1/dispersal-events', $this->payload($recipient, $parent, [
                'signature' => self::PNG,
                'signature_captured_at' => '2026-10-01T10:00:00+08:00',
            ]))
            ->assertCreated();

        $event = DispersalEvent::latest('id')->firstOrFail();

        $this->assertNotNull($event->signature_path);
        $this->assertStringStartsWith('dispersal-signatures/', $event->signature_path);
        Storage::disk('secure')->assertExists($event->signature_path);

        // Who and when travel with the image, not inside it.
        $this->assertSame($admin->id, $event->signature_captured_by);
        $this->assertSame('2026-10-01', $event->signature_captured_at->toDateString());

        $response
            ->assertJsonPath('data.has_signature', true)
            ->assertJsonPath('data.signature_captured_by', $admin->id);
        $this->assertNotEmpty($response->json('data.signature_url'));
    }

    public function test_a_dispersal_without_a_signature_still_records(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        [$parent, $recipient] = $this->pair();

        $response = $this->actingAs($admin)
            ->postJson('/api/v1/dispersal-events', $this->payload($recipient, $parent))
            ->assertCreated();

        $event = DispersalEvent::latest('id')->firstOrFail();

        $this->assertNull($event->signature_path);
        $this->assertFalse($event->hasSignature());

        $response
            ->assertJsonPath('data.has_signature', false)
            ->assertJsonPath('data.signature_url', null);
    }

    public function test_signature_must_be_a_png_data_url(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        [$parent, $recipient] = $this->pair();

        foreach ([
            'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
            'not-a-data-url',
            'data:image/png;base64,'.base64_encode('this is not a png'),
        ] as $bad) {
            $this->actingAs($admin)
                ->postJson('/api/v1/dispersal-events', $this->payload($recipient, $parent, [
                    'signature' => $bad,
                ]))
                ->assertStatus(422)
                ->assertJsonValidationErrors('signature');
        }

        $this->assertSame(0, DispersalEvent::count());
    }

    public function test_captured_by_comes_from_the_session_not_the_payload(): void
    {
        // A technician must pass the scoped exists rule, so both households
        // are theirs.
        $technician = User::factory()->create(['role' => 'technician']);
        $parent = Beneficiary::factory()->assignedTo($technician)->create();
        $recipient = Beneficiary::factory()->assignedTo($technician)->create();

        $this->actingAs($technician)
            ->postJson('/api/v1/dispersal-events', $this->payload($recipient, $parent, [
                'signature' => self::PNG,
                // Hostile payload: the client cannot attribute a signature to
                // someone else.
                'signature_captured_by' => 999999,
            ]))
            ->assertCreated();

        $event = DispersalEvent::latest('id')->firstOrFail();
        $this->assertSame($technician->id, $event->signature_captured_by);
    }

    public function test_signature_cannot_be_edited_after_capture(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        [$parent, $recipient] = $this->pair();

        $this->actingAs($admin)
            ->postJson('/api/v1/dispersal-events', $this->payload($recipient, $parent, [
                'signature' => self::PNG,
            ]))
            ->assertCreated();

        $event = DispersalEvent::latest('id')->firstOrFail();
        $originalPath = $event->signature_path;
        $originalBy = $event->signature_captured_by;
        $originalAt = $event->signature_captured_at;

        // Every later write to the signature fields is refused: history stays
        // intact. A genuine correction is a NEW event, never an edit.
        $event->update([
            'signature_path' => 'dispersal-signatures/hacked.png',
            'signature_captured_by' => 999999,
            'signature_captured_at' => now()->addYear(),
        ]);

        $fresh = $event->fresh();
        $this->assertSame($originalPath, $fresh->signature_path);
        $this->assertSame($originalBy, $fresh->signature_captured_by);
        $this->assertEquals($originalAt, $fresh->signature_captured_at);
        $this->assertFalse(Storage::disk('secure')->exists('dispersal-signatures/hacked.png'));
    }

    public function test_recapturing_creates_a_new_event_and_leaves_the_original_alone(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        [$parent, $recipient] = $this->pair();

        $this->actingAs($admin)->postJson('/api/v1/dispersal-events', $this->payload($recipient, $parent, [
            'signature' => self::PNG,
        ]))->assertCreated();

        $first = DispersalEvent::latest('id')->firstOrFail();
        $firstPath = $first->signature_path;

        // A second, separately recorded re-dispersal with its own signature.
        $this->actingAs($admin)->postJson('/api/v1/dispersal-events', $this->payload($recipient, $parent, [
            'signature' => self::PNG,
        ]))->assertCreated();

        $second = DispersalEvent::latest('id')->firstOrFail();

        $this->assertSame(2, DispersalEvent::count());
        $this->assertSame($firstPath, $first->fresh()->signature_path);
        $this->assertNotSame($firstPath, $second->signature_path);
    }

    public function test_guests_cannot_attach_a_signature(): void
    {
        [$parent, $recipient] = $this->pair();

        $this->postJson('/api/v1/dispersal-events', $this->payload($recipient, $parent, [
            'signature' => self::PNG,
        ]))->assertUnauthorized();

        $this->assertSame(0, DispersalEvent::count());
    }
}
