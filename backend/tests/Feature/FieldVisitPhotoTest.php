<?php

namespace Tests\Feature;

use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Geotagged field-visit photos: the composited image plus every structured
 * metadata field stored as real columns (queryable without reading pixels).
 */
class FieldVisitPhotoTest extends TestCase
{
    use RefreshDatabase;

    private function visit(): FieldVisit
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();

        return FieldVisit::factory()->create([
            'technician_id' => $technician->id,
            'beneficiary_id' => $beneficiary->id,
        ]);
    }

    /** The full metadata payload the client sends alongside the image. */
    private function meta(): array
    {
        return [
            'capture_date' => '2026-09-25',
            'capture_time' => '11:45:32',
            'timezone_offset' => 'UTC+08:00',
            'capture_year' => 2026,
            'capture_month' => 9,
            'capture_day' => 25,
            'capture_hour' => 11,
            'capture_minute' => 45,
            'capture_second' => 32,
            'capture_millisecond' => 500,
            'latitude' => 9.3068,
            'longitude' => 123.3054,
            'accuracy_m' => 8.5,
            'altitude_m' => 12.4,
            'speed_kmh' => 0,
            'heading_deg' => 180,
            'location_source' => 'gps',
            'address' => 'Dawis, Bayawan City',
        ];
    }

    public function test_upload_stores_the_image_and_every_metadata_field(): void
    {
        Storage::fake('public');
        $visit = $this->visit();

        $response = $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", $this->meta() + [
                'image' => UploadedFile::fake()->image('shot.jpg')->size(300),
            ]);

        $response->assertCreated();

        $photo = $visit->photos()->first();
        $this->assertNotNull($photo);
        Storage::disk('public')->assertExists($photo->image_path);

        // Structured data as real columns — every field from the reference table.
        $this->assertSame('2026-09-25', $photo->capture_date->toDateString());
        $this->assertSame('11:45:32', $photo->capture_time);
        $this->assertSame('UTC+08:00', $photo->timezone_offset);
        $this->assertSame(2026, $photo->capture_year);
        $this->assertSame(9, $photo->capture_month);
        $this->assertSame(25, $photo->capture_day);
        $this->assertSame(11, $photo->capture_hour);
        $this->assertSame(45, $photo->capture_minute);
        $this->assertSame(32, $photo->capture_second);
        $this->assertSame(500, $photo->capture_millisecond);
        $this->assertSame(9.3068, $photo->latitude);
        $this->assertSame(123.3054, $photo->longitude);
        $this->assertSame(8.5, $photo->accuracy_m);
        $this->assertSame(12.4, $photo->altitude_m);
        $this->assertSame(0.0, $photo->speed_kmh);
        $this->assertSame(180, $photo->heading_deg);
        $this->assertSame('gps', $photo->location_source);
        $this->assertSame('Dawis, Bayawan City', $photo->address);
        $this->assertSame($visit->technician->id, $photo->technician_id);

        // The visit answers has_photo so the UI (and the required rule) agree.
        $this->assertTrue($visit->refresh()->hasPhoto());
    }

    public function test_upload_accepts_a_photo_without_any_gps_fix(): void
    {
        Storage::fake('public');
        $visit = $this->visit();

        // No fix at capture time: location fields stay null, source is "none".
        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", [
                ...collect($this->meta())->except([
                    'latitude', 'longitude', 'accuracy_m', 'altitude_m',
                    'speed_kmh', 'heading_deg', 'location_source', 'address',
                ])->all(),
                'location_source' => 'none',
                'image' => UploadedFile::fake()->image('shot.jpg'),
            ])->assertCreated();

        $photo = $visit->photos()->first();
        $this->assertNull($photo->latitude);
        $this->assertNull($photo->longitude);
        $this->assertNull($photo->address);
        $this->assertSame('none', $photo->location_source);
    }

    public function test_a_retake_replaces_the_previous_photo_and_file(): void
    {
        Storage::fake('public');
        $visit = $this->visit();

        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", $this->meta() + [
                'image' => UploadedFile::fake()->image('first.jpg'),
            ])->assertCreated();

        $first = $visit->photos()->first();
        Storage::disk('public')->assertExists($first->image_path);

        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", array_merge($this->meta(), [
                'capture_second' => 59,
                'image' => UploadedFile::fake()->image('second.jpg'),
            ]))->assertCreated();

        // One row, one file — the first was deleted along with its disk file.
        $this->assertSame(1, $visit->photos()->count());
        Storage::disk('public')->assertMissing($first->image_path);
        $this->assertSame(59, $visit->photos()->first()->capture_second);
    }

    public function test_another_technician_cannot_attach_a_photo_to_someone_elses_visit(): void
    {
        Storage::fake('public');
        $visit = $this->visit();
        $stranger = User::factory()->create(['role' => 'technician']);

        $this->actingAs($stranger)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", $this->meta() + [
                'image' => UploadedFile::fake()->image('shot.jpg'),
            ])->assertForbidden();
    }

    public function test_upload_validates_the_metadata_payload(): void
    {
        Storage::fake('public');
        $visit = $this->visit();

        // Missing clock fields, out-of-range month, unknown location source.
        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", [
                'capture_date' => '2026-09-25',
                'image' => UploadedFile::fake()->image('shot.jpg'),
            ])->assertUnprocessable();

        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", array_merge($this->meta(), [
                'capture_month' => 13,
                'image' => UploadedFile::fake()->image('shot.jpg'),
            ]))->assertUnprocessable();

        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", array_merge($this->meta(), [
                'location_source' => 'psychic',
                'image' => UploadedFile::fake()->image('shot.jpg'),
            ]))->assertUnprocessable();

        $this->assertSame(0, $visit->photos()->count());
    }

    public function test_upload_rejects_an_oversized_image(): void
    {
        Storage::fake('public');
        $visit = $this->visit();

        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", $this->meta() + [
                'image' => UploadedFile::fake()->image('huge.jpg')->size(9000),
            ])->assertUnprocessable();

        $this->assertSame(0, $visit->photos()->count());
    }

    public function test_creating_a_visit_without_the_photo_assertion_is_rejected(): void
    {
        $technician = User::factory()->create(['role' => 'technician']);
        $beneficiary = Beneficiary::factory()->assignedTo($technician)->create();

        // Field evidence is mandatory on new visits: the client must assert it
        // has captured (and will upload) a photo before creation succeeds.
        $this->actingAs($technician)
            ->postJson('/api/v1/field-visits', [
                'beneficiary_id' => $beneficiary->id,
                'visited_on' => '2026-09-25',
                'purpose' => 'follow-up',
            ])->assertUnprocessable()
            ->assertJsonValidationErrors(['has_photo']);

        // Asserting it (the form enforces the capture first) passes.
        $this->actingAs($technician)
            ->postJson('/api/v1/field-visits', [
                'beneficiary_id' => $beneficiary->id,
                'visited_on' => '2026-09-25',
                'purpose' => 'follow-up',
                'has_photo' => true,
            ])->assertCreated();
    }

    public function test_delete_removes_the_row_and_the_file(): void
    {
        Storage::fake('public');
        $visit = $this->visit();

        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", $this->meta() + [
                'image' => UploadedFile::fake()->image('shot.jpg'),
            ])->assertCreated();

        $photo = $visit->photos()->first();

        $this->actingAs($visit->technician)
            ->deleteJson("/api/v1/field-visits/{$visit->id}/photo")
            ->assertNoContent();

        Storage::disk('public')->assertMissing($photo->image_path);
        $this->assertSame(0, $visit->photos()->count());
    }
}
