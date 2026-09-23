<?php

namespace App\Http\Controllers;

use App\Http\Requests\NotificationFeedRequest;
use App\Services\NotificationService;
use Illuminate\Http\JsonResponse;

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
            (int) ($validated['limit'] ?? NotificationService::DEFAULT_LIMIT),
        );

        // `meta` carries the counts so the header bell can show a badge from
        // the same response the page renders — one request, one source of
        // truth about how much needs attention.
        return response()->json([
            'data' => $feed['alerts'],
            'meta' => $feed['counts'],
        ]);
    }
}
