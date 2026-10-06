<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreDispersalEventRequest;
use App\Http\Requests\UpdateDispersalEventRequest;
use App\Http\Resources\BeneficiaryResource;
use App\Http\Resources\DispersalEventResource;
use App\Models\DispersalEvent;
use App\Services\DispersalEventService;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

class DispersalEventController extends Controller
{
    public function __construct(private readonly DispersalEventService $events) {}

    /**
     * Role-scoped dispersal events.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        return DispersalEventResource::collection(
            $this->events->listFor(
                $request->user(),
                Pagination::perPage($request->input('per_page')),
            ),
        );
    }

    /**
     * Record an initial dispersal or a re-dispersal (pass-on). A re-dispersal
     * may register the recipient household inline in the same transaction.
     */
    public function store(StoreDispersalEventRequest $request): JsonResponse
    {
        $event = $this->events->create($request->user(), $request->validated());

        return (new DispersalEventResource(
            $event->load(['beneficiary', 'parentBeneficiary', 'newBeneficiary']),
        ))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Role-scoped single fetch.
     */
    public function show(Request $request, int $id): DispersalEventResource
    {
        $event = $this->events->scopeQueryFor($request->user())
            ->with(['beneficiary', 'parentBeneficiary', 'newBeneficiary'])
            ->findOrFail($id);

        $this->authorize('view', $event);

        return new DispersalEventResource($event);
    }

    /**
     * Correct a recorded dispersal (admin, or the assigned technician). Only
     * the descriptive fields are editable — the recipient and the captured
     * signature are audit anchors (see UpdateDispersalEventRequest).
     */
    public function update(UpdateDispersalEventRequest $request, int $id): DispersalEventResource
    {
        $event = DispersalEvent::findOrFail($id);

        $this->authorize('update', $event);

        $event = $this->events->update($request->user(), $event, $request->validated());

        return new DispersalEventResource(
            $event->load(['beneficiary', 'parentBeneficiary', 'newBeneficiary']),
        );
    }

    /**
     * Soft-delete a recorded dispersal (admin, or the assigned technician).
     * Soft delete follows the rest of the system: the row leaves the lineage
     * and the list but stays recoverable.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $event = DispersalEvent::findOrFail($id);

        $this->authorize('delete', $event);

        $this->events->delete($request->user(), $event);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * The pass-on chain for one beneficiary: where the animal came from
     * (backwards to the original dispersal) plus where its offspring went.
     */
    public function lineage(Request $request, int $id): JsonResponse
    {
        $lineage = $this->events->lineageFor($request->user(), $id);

        abort_unless($lineage, Response::HTTP_NOT_FOUND);

        return response()->json([
            'data' => [
                'beneficiary' => new BeneficiaryResource($lineage['current']),
                'chain' => $lineage['chain'],
                // Direct offspring (one level) kept for existing callers.
                'descendant_events' => $lineage['descendant_events'],
                // The full multi-generation offspring tree for the genealogy view.
                'descendant_tree' => $lineage['descendant_tree'],
            ],
        ]);
    }
}
