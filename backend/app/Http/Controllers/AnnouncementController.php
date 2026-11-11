<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreAnnouncementRequest;
use App\Http\Requests\UpdateAnnouncementRequest;
use App\Models\Announcement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Veterinary announcements — two audiences, one table.
 *
 * - `index` (public, session-free) feeds the landing page's announcements
 *   block: published rows only, pinned first, newest first.
 * - the CRUD methods (admin-only — the route group enforces EnsureUserIsAdmin
 *   + permission:manage_settings, and the FormRequests re-check it) are the
 *   admin editor. `published` is the form's flag; it maps to published_at
 *   (now() when publishing, null when unpublishing) so "draft" and "live"
 *   stay one boolean away from each other, like the rest of this repo's
 *   deliberately small workflows.
 */
class AnnouncementController extends Controller
{
    /**
     * Public: published announcements for the landing page.
     */
    public function publicIndex(Request $request): JsonResponse
    {
        $limit = min(max((int) $request->query('limit', 3), 1), 20);

        $announcements = Announcement::published()
            ->limit($limit)
            ->get(['id', 'title', 'body', 'is_pinned', 'published_at'])
            ->map(static fn (Announcement $announcement): array => [
                'id' => $announcement->id,
                'title' => $announcement->title,
                'body' => $announcement->body,
                'is_pinned' => $announcement->is_pinned,
                'published_at' => $announcement->published_at?->toIso8601String(),
            ])
            ->values();

        return response()->json(['data' => $announcements]);
    }

    /**
     * Admin: every announcement, drafts included.
     */
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => Announcement::query()
                ->orderByDesc('is_pinned')
                ->orderByDesc('published_at')
                ->orderByDesc('id')
                ->get(),
        ]);
    }

    public function store(StoreAnnouncementRequest $request): JsonResponse
    {
        $announcement = Announcement::create($this->payload($request));

        return response()->json(['data' => $announcement], Response::HTTP_CREATED);
    }

    public function update(UpdateAnnouncementRequest $request, Announcement $announcement): JsonResponse
    {
        $announcement->update($this->payload($request, $announcement));

        return response()->json(['data' => $announcement->refresh()]);
    }

    public function destroy(Announcement $announcement): JsonResponse
    {
        $announcement->delete();

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * The validated payload mapped onto the model: the form's `published`
     * boolean becomes published_at — now() when publishing (or already
     * published), null when the admin pulls the row back to a draft.
     *
     * @return array<string, mixed>
     */
    private function payload(StoreAnnouncementRequest|UpdateAnnouncementRequest $request, ?Announcement $existing = null): array
    {
        $published = $request->boolean('published');

        return [
            'title' => $request->validated('title'),
            'body' => $request->validated('body'),
            'is_pinned' => $request->boolean('is_pinned'),
            'published_at' => $published
                ? ($existing?->published_at ?? now())
                : null,
        ];
    }
}
