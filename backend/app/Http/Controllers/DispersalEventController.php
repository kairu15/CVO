<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreDispersalEventRequest;
use App\Http\Resources\BeneficiaryResource;
use App\Http\Resources\DispersalEventResource;
use App\Services\DispersalEventService;
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
            $this->events->listFor($request->user()),
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
                'descendant_events' => $lineage['descendant_events'],
            ],
        ]);
    }
}
