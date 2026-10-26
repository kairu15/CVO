<?php

namespace App\Http\Controllers;

use App\Http\Requests\ActivityLogRequest;
use App\Models\ActivityLog;
use App\Models\User;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use App\Http\Resources\ActivityLogResource;

/**
 * Read-only access to the security audit trail (item 7) — admin only by
 * route middleware (EnsureUserIsAdmin) plus the authorize() on the request.
 *
 * There is deliberately no store/update/destroy here: the log is append-only
 * (writes go through AuditLogger from the actions themselves) and must never
 * be editable through the API.
 */
class ActivityLogController extends Controller
{
    /**
     * Paginated, filterable audit log, newest first.
     */
    public function index(ActivityLogRequest $request): AnonymousResourceCollection
    {
        $validated = $request->validated();

        $logs = ActivityLog::query()
            ->with('actor:id,name,email,role')
            ->when($validated['action'] ?? null, fn ($q, $action) => $q->where('action', $action))
            ->when($validated['actor_id'] ?? null, fn ($q, $actorId) => $q->where('actor_id', $actorId))
            ->when($validated['target_type'] ?? null, fn ($q, $type) => $q->where('target_type', $type))
            ->when($validated['date_from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from))
            ->when($validated['date_to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to))
            ->when($validated['search'] ?? null, function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->whereHas('actor', function ($uq) use ($search): void {
                        $uq->where('name', 'like', "%{$search}%")
                            ->orWhere('email', 'like', "%{$search}%");
                    })->orWhere('target_type', 'like', "%{$search}%");
                });
            })
            ->latest('created_at')
            ->latest('id')
            ->paginate(Pagination::perPage($validated['per_page'] ?? null));

        return ActivityLogResource::collection($logs);
    }

    /**
     * The filter vocabulary for the audit page, in one response: the action
     * list AuditLogger validates writes against, the entity types that exist
     * so far, and the actors who appear in the log.
     */
    public function actions(): JsonResponse
    {
        return response()->json([
            'data' => [
                'actions' => ActivityLog::ACTIONS,
                'target_types' => ActivityLog::query()
                    ->whereNotNull('target_type')
                    ->distinct()
                    ->orderBy('target_type')
                    ->pluck('target_type')
                    ->all(),
                'actors' => ActivityLog::query()
                    ->whereNotNull('actor_id')
                    ->distinct()
                    ->orderBy('actor_id')
                    ->limit(200)
                    ->pluck('actor_id')
                    ->pipe(fn ($ids) => User::query()
                        ->withTrashed()
                        ->whereIn('id', $ids)
                        ->get(['id', 'name', 'email'])
                        ->values()),
            ],
        ]);
    }
}
