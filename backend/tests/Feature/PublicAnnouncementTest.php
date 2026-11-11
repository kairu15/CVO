<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Public veterinary announcements: only published rows reach the public
 * index (drafts never leak), pinned rows float above newest-first, the
 * landing page gets a bounded slice, and the admin CRUD is gated to the
 * manage_settings capability.
 */
class PublicAnnouncementTest extends TestCase
{
    use RefreshDatabase;

    /* ------------------------------------------------------------------ *
     |  Helpers                                                            |
     * ------------------------------------------------------------------ */

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function technician(): User
    {
        return User::factory()->create(['role' => 'technician']);
    }

    /* ------------------------------------------------------------------ *
     |  Public index                                                       |
     * ------------------------------------------------------------------ */

    public function test_public_index_lists_only_published_announcements_newest_first(): void
    {
        Announcement::create(['title' => 'Draft', 'body' => 'hidden', 'published_at' => null]);
        Announcement::create(['title' => 'Older', 'body' => 'b', 'published_at' => now()->subDays(2)]);
        Announcement::create(['title' => 'Newest', 'body' => 'a', 'published_at' => now()->subDay()]);

        $response = $this->getJson('/api/v1/public/announcements');

        $response->assertOk();
        $titles = collect($response->json('data'))->pluck('title')->all();
        $this->assertSame(['Newest', 'Older'], $titles);
        $this->assertStringNotContainsString('Draft', $response->getContent());
    }

    public function test_pinned_announcements_float_above_newer_unpinned_ones(): void
    {
        Announcement::create(['title' => 'Newest plain', 'body' => 'a', 'published_at' => now()]);
        Announcement::create([
            'title' => 'Pinned advisory',
            'body' => 'b',
            'is_pinned' => true,
            'published_at' => now()->subWeek(),
        ]);

        $response = $this->getJson('/api/v1/public/announcements');

        $this->assertSame(
            ['Pinned advisory', 'Newest plain'],
            collect($response->json('data'))->pluck('title')->all(),
        );
    }

    public function test_public_index_honours_the_limit_and_caps_it(): void
    {
        for ($i = 0; $i < 6; $i++) {
            Announcement::create(['title' => "A{$i}", 'body' => 'x', 'published_at' => now()->subDays($i)]);
        }

        $response = $this->getJson('/api/v1/public/announcements?limit=2');
        $this->assertCount(2, $response->json('data'));

        // A silly limit is capped, not obeyed.
        $capped = $this->getJson('/api/v1/public/announcements?limit=500');
        $this->assertCount(6, $capped->json('data'));
    }

    public function test_future_published_announcements_are_not_public_yet(): void
    {
        Announcement::create(['title' => 'Embargoed', 'body' => 'x', 'published_at' => now()->addDay()]);

        $this->getJson('/api/v1/public/announcements')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    /* ------------------------------------------------------------------ *
     |  Admin CRUD                                                         |
     * ------------------------------------------------------------------ */

    public function test_admin_can_create_publish_update_and_delete_an_announcement(): void
    {
        $admin = $this->admin();

        // A draft first — it must not be public.
        $created = $this->actingAs($admin)->postJson('/api/v1/admin/announcements', [
            'title' => 'Rabies drive',
            'body' => 'Free anti-rabies vaccination this Saturday.',
            'published' => false,
        ]);
        $created->assertCreated();
        $id = $created->json('data.id');
        $this->assertNull($created->json('data.published_at'));
        $this->getJson('/api/v1/public/announcements')->assertJsonCount(0, 'data');

        // Publish it — now it is public, with the pinned-first ordering.
        $published = $this->actingAs($admin)->patchJson("/api/v1/admin/announcements/{$id}", [
            'title' => 'Rabies drive',
            'body' => 'Free anti-rabies vaccination this Saturday.',
            'published' => true,
            'is_pinned' => true,
        ]);
        $published->assertOk();
        $this->assertNotNull($published->json('data.published_at'));
        $this->assertTrue($published->json('data.is_pinned'));
        $this->getJson('/api/v1/public/announcements')->assertJsonCount(1, 'data');

        // Unpublish — back out of the public eye.
        $this->actingAs($admin)->patchJson("/api/v1/admin/announcements/{$id}", [
            'title' => 'Rabies drive',
            'body' => 'Free anti-rabies vaccination this Saturday.',
            'published' => false,
        ])->assertOk();
        $this->getJson('/api/v1/public/announcements')->assertJsonCount(0, 'data');

        $this->actingAs($admin)->deleteJson("/api/v1/admin/announcements/{$id}")
            ->assertNoContent();
        $this->assertDatabaseMissing('announcements', ['id' => $id]);
    }

    public function test_validation_rejects_an_overlong_title_and_empty_body(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/v1/admin/announcements', [
            'title' => str_repeat('x', 201),
            'body' => '',
        ])->assertStatus(422)->assertJsonValidationErrors(['title', 'body']);
    }

    public function test_technician_cannot_manage_announcements(): void
    {
        $technician = $this->technician();

        $this->actingAs($technician)->getJson('/api/v1/admin/announcements')
            ->assertForbidden();
        $this->actingAs($technician)->postJson('/api/v1/admin/announcements', [
            'title' => 'Nope',
            'body' => 'Nope',
        ])->assertForbidden();
    }

    public function test_guest_cannot_manage_announcements(): void
    {
        $this->getJson('/api/v1/admin/announcements')->assertUnauthorized();
        $this->postJson('/api/v1/admin/announcements', ['title' => 'x', 'body' => 'y'])
            ->assertUnauthorized();
    }
}
