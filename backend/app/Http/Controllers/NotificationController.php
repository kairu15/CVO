<?php

namespace App\Http\Controllers;

use App\Http\Requests\NotificationBulkRequest;
use App\Http\Requests\NotificationFeedRequest;
use App\Http\Requests\NotificationPreferenceRequest;
use App\Models\UserNotification;
use App\Services\NotificationService;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;

/**
 * The notification centre API.
 *
 * Derived alerts remain read-only (they clear when their record changes), but
 * stored events have per-recipient read/archive state. Every route is scoped to
 * the authenticated caller; there is no user id in any path or payload.
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
            Arr::only($validated, ['status', 'category', 'priority', 'search', 'from', 'to']),
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

    /**
     * The caller's own category switches. No {id}: preferences are always
     * read from and written to the authenticated account.
     */
    public function preferences(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->preferencePayload($request->user()),
        ]);
    }

    public function updatePreferences(NotificationPreferenceRequest $request): JsonResponse
    {
        $preferences = $this->notifications->updatePreferences(
            $request->user(),
            $request->validated('preferences'),
        );

        return response()->json([
            'data' => [
                'preferences' => $preferences,
                'categories' => $this->categoryOptions(),
            ],
        ]);
    }

    /**
     * Bulk read/unread/archive/unarchive/delete over the caller's own rows.
     * One endpoint instead of five near-identical routes.
     */
    public function bulk(NotificationBulkRequest $request): JsonResponse
    {
        $validated = $request->validated();

        return response()->json([
            'data' => [
                'changed' => $this->notifications->bulk(
                    $request->user(),
                    array_map('intval', $validated['ids']),
                    $validated['action'],
                ),
            ],
        ]);
    }

    /** @return array{preferences: array<string, bool>, categories: list<array{key: string, label: string}>} */
    private function preferencePayload(\App\Models\User $user): array
    {
        return [
            'preferences' => $this->notifications->preferences($user),
            'categories' => $this->categoryOptions(),
        ];
    }

    /** @return list<array{key: string, label: string}> */
    private function categoryOptions(): array
    {
        return collect(UserNotification::CATEGORY_LABELS)
            ->map(fn (string $label, string $key): array => ['key' => $key, 'label' => $label])
            ->values()
            ->all();
    }
}
