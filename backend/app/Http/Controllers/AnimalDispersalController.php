<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreDispersalRequest;
use App\Http\Requests\StorePassOnRequest;
use App\Http\Requests\StoreReDispersalRequest;
use App\Http\Requests\StoreReturnRequest;
use App\Http\Requests\VoidOwnershipEventRequest;
use App\Http\Resources\AnimalOwnershipEventResource;
use App\Http\Resources\AnimalResource;
use App\Models\AnimalOwnershipEvent;
use App\Services\AnimalDispersalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The ownership chain's HTTP surface. Every write is a thin pass-through to
 * AnimalDispersalService (which owns the transaction, the locks and the rules)
 * and answers with the created event; the two reads return the chain and the
 * ready-to-draw flight path.
 *
 * The `{animal}` / `{event}` route parameters are intentionally NOT bound to
 * models: scoping a technician to the animals they may see is
 * AnimalDispersalService::findFor's job, and implicit binding would bypass it.
 */
class AnimalDispersalController extends Controller
{
    public function __construct(private readonly AnimalDispersalService $dispersals) {}

    /** Create an animal and its first (`dispersal`) event, from CVO. */
    public function disperse(StoreDispersalRequest $request): JsonResponse
    {
        $event = $this->dispersals->disperse($request->user(), $request->validated());

        return $this->eventResponse($event, Response::HTTP_CREATED);
    }

    /** Move the SAME animal to a new owner. */
    public function redisperse(StoreReDispersalRequest $request, int $animal): JsonResponse
    {
        $event = $this->dispersals->redisperse($request->user(), $animal, $request->validated());

        return $this->eventResponse($event, Response::HTTP_CREATED);
    }

    /** Pass an offspring of this animal on to a new beneficiary. */
    public function passOn(StorePassOnRequest $request, int $animal): JsonResponse
    {
        $event = $this->dispersals->passOn($request->user(), $animal, $request->validated());

        return $this->eventResponse($event, Response::HTTP_CREATED);
    }

    /** Hand the animal back to CVO. */
    public function returnToCvo(StoreReturnRequest $request, int $animal): JsonResponse
    {
        $event = $this->dispersals->returnToCvo($request->user(), $animal, $request->validated());

        return $this->eventResponse($event, Response::HTTP_CREATED);
    }

    /** Void an event and recompute the chain. */
    public function voidEvent(VoidOwnershipEventRequest $request, int $event): JsonResponse
    {
        $voided = $this->dispersals->voidEvent(
            $request->user(),
            $event,
            $request->validated()['void_reason'],
        );

        return $this->eventResponse($voided, Response::HTTP_OK);
    }

    /**
     * One animal's ownership chain, with owner visibility applied for the
     * caller (technicians see other owners masked at barangay level).
     */
    public function ownershipChain(Request $request, int $animal): JsonResponse
    {
        $chain = $this->dispersals->ownershipChainFor(
            $request->user(),
            $animal,
            $request->boolean('include_voided'),
        );

        return response()->json([
            'data' => [
                'animal' => new AnimalResource($chain['animal']),
                'current_owner' => $chain['current_owner'],
                'events' => $chain['events'],
                'latest_event_id' => $chain['latest_event_id'],
            ],
        ]);
    }

    /**
     * The animals a household currently holds — lets the web and mobile UI
     * resolve the animal to act on from the beneficiary it already shows.
     */
    public function beneficiaryAnimals(Request $request, int $id): JsonResponse
    {
        return response()->json([
            'data' => AnimalResource::collection(
                $this->dispersals->animalsOwnedBy($request->user(), $id),
            )->resolve(),
        ]);
    }

    /** The ready-to-draw flight path for one animal. */
    public function flightPath(Request $request, int $animal): JsonResponse
    {
        return response()->json([
            'data' => $this->dispersals->flightPathFor(
                $request->user(),
                $animal,
                $request->boolean('include_voided'),
            ),
        ]);
    }

    private function eventResponse(AnimalOwnershipEvent $event, int $status): JsonResponse
    {
        return (new AnimalOwnershipEventResource(
            $event->load(['animal.animalType', 'animal.animalClassification', 'fromBeneficiary', 'toBeneficiary']),
        ))
            ->response()
            ->setStatusCode($status);
    }
}
