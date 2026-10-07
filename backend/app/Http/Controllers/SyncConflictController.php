<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreSyncConflictRequest;
use App\Http\Resources\SyncConflictResource;
use App\Models\SyncConflict;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

/**
 * Offline sync conflicts.
 *
 * The client detects a conflict (a queued edit that would overwrite a record
 * the server changed after the item was queued) and reports the technician's
 * decision here so it becomes part of the program's record. Read-only and
 * append-only server-side: nothing is merged or re-applied, the queue owns the
 * payload.
 */
class SyncConflictController extends Controller
{
    /**
     * Log one conflict resolution. Always stamped with the caller.
     */
    public function store(StoreSyncConflictRequest $request): JsonResponse
    {
        $conflict = SyncConflict::create([
            ...$request->validated(),
            'user_id' => $request->user()->id,
        ]);

        return (new SyncConflictResource($conflict->load('user')))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Admin audit view of every logged conflict, newest first.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        return SyncConflictResource::collection(
            SyncConflict::query()
                ->with('user')
                ->latest()
                ->paginate(Pagination::perPage($request->input('per_page'))),
        );
    }
}
