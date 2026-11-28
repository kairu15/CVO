<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Digital farmer signature on monitoring visits.
 *
 * The signature is captured on the technician's device, stored privately, and
 * attached to exactly one monitoring record. It is viewable by the staff roles
 * that can already view the record, survives unrelated edits, and is only
 * swapped when the replacement is intentional.
 */
class MonitoringSignatureTest extends TestCase
{
    use RefreshDatabase;

    /** A real 1x1 PNG as a data URL — the shape a canvas signature arrives in. */
    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    private User $technician;

    private Beneficiary $beneficiary;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('secure');

        $this->technician = User::factory()->create(['role' => 'technician']);
        $this->beneficiary = Beneficiary::factory()->assignedTo($this->technician)->create();
    }

    private function createVisit(array $extra = []): MonitoringRecord
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/monitoring-records', $extra + [
                'beneficiary_id' => $this->beneficiary->id,
                'date_monitored' => now()->toDateString(),
            ])
            ->assertCreated();

        return MonitoringRecord::latest('id')->firstOrFail();
    }

    public function test_a_captured_signature_is_stored_privately_with_provenance(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/monitoring-records', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_monitored' => now()->toDateString(),
                'signature' => self::PNG,
                'signature_signed_at' => '2026-11-28T09:15:00+08:00',
            ])
            ->assertCreated()
            ->assertJsonPath('data.has_farmer_signature', true)
            ->assertJsonPath('data.signature_captured_by', $this->technician->id)
            ->assertJsonPath('data.signature_mime_type', 'image/png')
            ->assertJsonPath('data.signature_captured_by_name', $this->technician->name);

        $record = MonitoringRecord::latest('id')->firstOrFail();

        $this->assertNotNull($record->farmer_signature_path);
        $this->assertStringStartsWith('monitoring-signatures/', $record->farmer_signature_path);
        $this->assertStringEndsWith('.png', $record->farmer_signature_path);
        Storage::disk('secure')->assertExists($record->farmer_signature_path);

        $this->assertSame($this->technician->id, $record->signature_captured_by);
        $this->assertSame('2026-11-28', $record->farmer_signed_at->toDateString());
        $this->assertTrue($record->hasFarmerSignature());
    }

    public function test_the_signature_url_is_a_short_lived_relative_signed_url(): void
    {
        $record = $this->createVisit(['signature' => self::PNG]);

        // Storage::fake() swaps in its own `?expiration=` stand-in URL, so
        // generate this one against the real disk configuration to assert the
        // actual private-media shape the SPA resolves.
        Storage::forgetDisk('secure');

        $response = $this->actingAs($this->technician)
            ->getJson("/api/v1/monitoring-records/{$record->id}")
            ->assertOk();

        $url = $response->json('data.farmer_signature_url');

        $this->assertNotEmpty($url);
        // Never a public /storage path, and host-agnostic so it works behind
        // the Vite proxy or a tunnel.
        $this->assertStringStartsWith('/secure-files/monitoring-signatures/', $url);
        $this->assertStringContainsString('signature=', $url);
    }

    public function test_a_visit_without_a_signature_reports_none(): void
    {
        $response = $this->actingAs($this->technician)
            ->postJson('/api/v1/monitoring-records', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_monitored' => now()->toDateString(),
            ])
            ->assertCreated()
            ->assertJsonPath('data.has_farmer_signature', false)
            ->assertJsonPath('data.farmer_signature_url', null)
            ->assertJsonPath('data.farmer_signed_at', null);

        $this->assertNull(MonitoringRecord::latest('id')->firstOrFail()->farmer_signature_path);
    }

    public function test_only_a_real_png_signature_is_accepted(): void
    {
        foreach ([
            'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
            'not-a-data-url',
            'data:image/png;base64,'.base64_encode('this is not a png'),
            'data:image/png;base64,'.base64_encode("\x89PNG\r\n\x1a\n".str_repeat('x', 2_100_000)),
        ] as $bad) {
            $this->actingAs($this->technician)
                ->postJson('/api/v1/monitoring-records', [
                    'beneficiary_id' => $this->beneficiary->id,
                    'date_monitored' => now()->toDateString(),
                    'signature' => $bad,
                ])
                ->assertUnprocessable()
                ->assertJsonValidationErrors('signature');
        }

        // A rejected submission creates neither a record nor a file.
        $this->assertSame(0, MonitoringRecord::count());
        $this->assertSame([], Storage::disk('secure')->allFiles());
    }

    public function test_captured_by_comes_from_the_session_not_the_payload(): void
    {
        $this->actingAs($this->technician)
            ->postJson('/api/v1/monitoring-records', [
                'beneficiary_id' => $this->beneficiary->id,
                'date_monitored' => now()->toDateString(),
                'signature' => self::PNG,
                'signature_captured_by' => 999999,
            ])
            ->assertCreated();

        $record = MonitoringRecord::latest('id')->firstOrFail();

        $this->assertSame($this->technician->id, $record->signature_captured_by);
        $this->assertNotSame(999999, $record->signature_captured_by);
    }

    public function test_editing_an_unrelated_field_preserves_the_signature(): void
    {
        $record = $this->createVisit(['signature' => self::PNG]);

        $path = $record->farmer_signature_path;
        $signedAt = $record->farmer_signed_at?->toIso8601String();
        $capturedBy = $record->signature_captured_by;

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/monitoring-records/{$record->id}", [
                'remarks' => 'Updated remarks only',
                'vaccination_date' => now()->toDateString(),
            ])
            ->assertOk()
            ->assertJsonPath('data.remarks', 'Updated remarks only')
            ->assertJsonPath('data.has_farmer_signature', true);

        $fresh = $record->fresh();

        $this->assertSame($path, $fresh->farmer_signature_path);
        $this->assertSame($capturedBy, $fresh->signature_captured_by);
        $this->assertSame($signedAt, $fresh->farmer_signed_at?->toIso8601String());
        Storage::disk('secure')->assertExists($path);
    }

    public function test_an_intentional_replacement_swaps_the_image_and_deletes_the_old_file(): void
    {
        $record = $this->createVisit(['signature' => self::PNG]);
        $oldPath = $record->farmer_signature_path;

        $this->actingAs($this->technician)
            ->patchJson("/api/v1/monitoring-records/{$record->id}", [
                'signature' => self::PNG,
                'signature_signed_at' => '2026-11-29T08:00:00+08:00',
            ])
            ->assertOk()
            ->assertJsonPath('data.has_farmer_signature', true);

        $fresh = $record->fresh();

        $this->assertNotSame($oldPath, $fresh->farmer_signature_path);
        Storage::disk('secure')->assertExists($fresh->farmer_signature_path);
        Storage::disk('secure')->assertMissing($oldPath);
        $this->assertSame('2026-11-29', $fresh->farmer_signed_at->toDateString());
    }

    public function test_a_failed_update_leaves_the_existing_signature_and_files_intact(): void
    {
        $record = $this->createVisit(['signature' => self::PNG]);
        $path = $record->farmer_signature_path;

        // Invalid BCS: the request is rejected before the service runs.
        $this->actingAs($this->technician)
            ->patchJson("/api/v1/monitoring-records/{$record->id}", [
                'bcs' => 99,
                'signature' => self::PNG,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('bcs');

        $this->assertSame($path, $record->fresh()->farmer_signature_path);
        $this->assertSame([$path], Storage::disk('secure')->allFiles());
    }

    public function test_an_admin_can_view_the_saved_signature_on_the_record(): void
    {
        $record = $this->createVisit(['signature' => self::PNG]);

        $response = $this->actingAs(User::factory()->create(['role' => 'admin']))
            ->getJson("/api/v1/monitoring-records/{$record->id}")
            ->assertOk()
            ->assertJsonPath('data.has_farmer_signature', true)
            ->assertJsonPath('data.name_of_farmer', $this->beneficiary->name_of_farmer)
            ->assertJsonPath('data.signature_captured_by_name', $this->technician->name);

        $this->assertNotEmpty($response->json('data.farmer_signature_url'));
    }

    public function test_guests_cannot_capture_or_read_signatures(): void
    {
        $this->postJson('/api/v1/monitoring-records', [
            'beneficiary_id' => $this->beneficiary->id,
            'date_monitored' => now()->toDateString(),
            'signature' => self::PNG,
        ])->assertUnauthorized();

        $record = MonitoringRecord::factory()
            ->by($this->technician)
            ->for($this->beneficiary, 'beneficiary')
            ->create(['farmer_signature_path' => 'monitoring-signatures/secret.png']);

        $this->getJson("/api/v1/monitoring-records/{$record->id}")->assertUnauthorized();
        $this->assertSame([], Storage::disk('secure')->allFiles());
    }

    public function test_signature_files_are_not_reachable_without_a_valid_signed_url(): void
    {
        Storage::disk('secure')->put('monitoring-signatures/secret.png', 'png');

        // The private disk's serve route only releases a file to a request
        // carrying a valid signature — a guessed path is not enough.
        $this->get('/secure-files/monitoring-signatures/secret.png')->assertForbidden();
    }
}
