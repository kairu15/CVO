<?php

namespace App\Http\Controllers;

use App\Http\Requests\NotificationFeedRequest;
use App\Services\NotificationService;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The notification feed — read-only, derived from existing records.
 *
 * There is no store/update/destroy and nothing to mark as read: each alert
 * restates a dispersal event or a vaccination already on record, so the only
 * way to resolve one is to record the visit or movement it is about. See
 * NotificationService for why this has no backing table.
 */
class NotificationController extends Controller
{
    public function __construct(private readonly NotificationService $notifications) {}

    public function index(NotificationFeedRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $feed = $this->notifications->feed(
            $request->user(),
            // `per_page` is the system-wide name; `limit` is the feed's
            // historical alias for the same page size. Either is clamped to 50.
            Pagination::perPage($validated['per_page'] ?? $validated['limit'] ?? null),
            $validated['filter'] ?? NotificationService::FILTER_ALL,
            (int) ($validated['page'] ?? 1),
        );

        // `meta` carries the counts so the header bell can show a badge from
        // the same response the page renders — one request, one source of
        // truth about how much needs attention.
        return response()->json([
            'data' => $feed['alerts'],
            'meta' => $feed['counts'],
        ]);
    }

    /**
     * Just the unread stored-event count — the bell badge number. A single
     * cheap COUNT the frontend polls; separate from the feed endpoint so a
     * badge tick never re-derives vaccination/dispersal alerts.
     */
    public function unreadCount(Request $request): JsonResponse
    {
        return response()->json([
            'data' => [
                'unread' => $this->notifications->unreadCount($request->user()),
            ],
        ]);
    }

    /**
     * Mark every stored event notification read for the caller.
     */
    public function markAllRead(Request $request): JsonResponse
    {
        $marked = $this->notifications->markAllRead($request->user());

        return response()->json([
            'data' => ['marked' => $marked],
        ]);
    }

    /**
     * Mark one stored event read — what opening that notification writes.
     * The service scopes it to the caller's own rows, so an id that is not
     * theirs reports false instead of reading someone else's notification.
     */
    public function markRead(Request $request, int $id): JsonResponse
    {
        return response()->json([
            'data' => ['marked' => $this->notifications->markRead($request->user(), $id)],
        ]);
    }
}
