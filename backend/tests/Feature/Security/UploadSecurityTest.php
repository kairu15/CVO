<?php

namespace Tests\Feature\Security;

use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Item 8 — secure file uploads.
 *
 * Happy path: a valid photo lands on the private disk under a server-
 * generated name and is served through a signed URL. Abuse cases: a
 * PHP/script payload disguised as an image is refused by content sniffing
 * (not merely by extension), oversized uploads are refused, the client's
 * filename never reaches the disk, and the file is NOT on the public disk.
 */
class UploadSecurityTest extends TestCase
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

    private function meta(): array
    {
        return [
            'capture_date' => '2026-09-27',
            'capture_time' => '10:00:00',
            'timezone_offset' => 'UTC+08:00',
            'capture_year' => 2026,
            'capture_month' => 9,
            'capture_day' => 27,
            'capture_hour' => 10,
            'capture_minute' => 0,
            'capture_second' => 0,
            'location_source' => 'none',
        ];
    }

    public function test_upload_lands_on_the_private_disk_under_a_server_generated_name(): void
    {
        Storage::fake('public');
        Storage::fake('secure');

        $visit = $this->visit();

        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", $this->meta() + [
                'image' => UploadedFile::fake()->image('totally-real-photo.jpg'),
            ])->assertCreated();

        $photo = $visit->photos()->first();

        // On the PRIVATE disk...
        Storage::disk('secure')->assertExists($photo->image_path);
        Storage::disk('public')->assertMissing($photo->image_path);

        // ...under a random name — the client's filename was discarded.
        $this->assertStringStartsWith('field-visits/'.$visit->id.'/', $photo->image_path);
        $this->assertStringNotContainsString('totally-real', $photo->image_path);
        $this->assertMatchesRegularExpression(
            '/^[a-z0-9]{40}\.jpg$/i',
            basename($photo->image_path),
            'The stored name must be server-generated, not client-controlled.',
        );

        // And the API hands back a temporary URL, not a public webroot path.
        // The signed URL is a presentation concern that lives on the API
        // resource (FieldVisitPhotoResource) — the model deliberately carries
        // only the storage path — so assert through the resource
        // serialization. (Storage::fake() swaps the temporary-URL callback
        // for a path+expiration double; the literal `signature=` parameter
        // only appears on the real local adapter's temporarySignedRoute.)
        $payload = (new \App\Http\Resources\FieldVisitPhotoResource($photo))->toArray(request());

        $this->assertArrayHasKey('image_url', $payload);
        $this->assertStringContainsString('field-visits/', (string) $payload['image_url']);
        $this->assertStringNotContainsString('/storage/', (string) $payload['image_url']);

        // The abuse case behind signed URLs: the file's path alone must NOT
        // serve the bytes. The secure disk is private and its serve route
        // requires a valid signature — an unsigned fetch is refused.
        $this->get('/secure-files/'.$photo->image_path)->assertStatus(403);
    }

    public function test_a_php_payload_disguised_as_an_image_is_refused(): void
    {
        Storage::fake('public');
        Storage::fake('secure');

        $visit = $this->visit();

        // A real PHP file renamed to .jpg: content sniffing must win.
        $php = UploadedFile::fake()->createWithContent(
            'shell.php.jpg',
            "<?php system(\$_GET['c']); ?>",
        );

        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", $this->meta() + [
                'image' => $php,
            ])->assertUnprocessable();

        $this->assertSame(0, $visit->photos()->count());
    }

    public function test_an_svg_payload_is_refused(): void
    {
        Storage::fake('public');
        Storage::fake('secure');

        $visit = $this->visit();

        // SVG can carry <script> — it is not on the allow-list, and the
        // sniffed type (image/svg+xml) fails the `image` rule's mimes check.
        $svg = UploadedFile::fake()->createWithContent(
            'evil.svg',
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        );

        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", $this->meta() + [
                'image' => $svg,
            ])->assertUnprocessable();

        $this->assertSame(0, $visit->photos()->count());
    }

    public function test_an_oversized_upload_is_refused(): void
    {
        Storage::fake('public');
        Storage::fake('secure');

        $visit = $this->visit();

        $this->actingAs($visit->technician)
            ->postJson("/api/v1/field-visits/{$visit->id}/photo", $this->meta() + [
                'image' => UploadedFile::fake()->image('huge.jpg')->size(9000), // > 8 MB cap
            ])->assertUnprocessable();

        $this->assertSame(0, $visit->photos()->count());
    }

    public function test_avatar_uploads_follow_the_same_pipeline(): void
    {
        Storage::fake('public');
        Storage::fake('secure');

        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/v1/profile/avatar', [
                'avatar' => UploadedFile::fake()->createWithContent('avatar.php.jpg', '<?php echo 1; ?>'),
            ])->assertUnprocessable();

        $this->actingAs($user)
            ->postJson('/api/v1/profile/avatar', [
                'avatar' => UploadedFile::fake()->image('me.jpg'),
            ])->assertOk();

        $user->refresh();
        $this->assertNotNull($user->avatar_path);
        Storage::disk('secure')->assertExists($user->avatar_path);
        Storage::disk('public')->assertMissing($user->avatar_path);
    }
}
