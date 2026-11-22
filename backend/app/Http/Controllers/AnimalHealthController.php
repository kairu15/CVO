<?php

namespace App\Http\Controllers;

use App\Http\Requests\AnimalHealthRequest;
use App\Http\Resources\AnimalHealthDetailResource;
use App\Http\Resources\AnimalHealthResource;
use App\Services\AnimalHealthService;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Animal health monitoring — read-only, aggregated from existing records.
 *
 * No store/update/destroy and no backing table: recording an examination,
 * observation, vaccination or visit happens on the module that owns it.
 */
class AnimalHealthController extends Controller
{
    public function __construct(private readonly AnimalHealthService $health) {}

    public function index(AnimalHealthRequest $request): AnonymousResourceCollection
    {
        $validated = $request->validated();

        return AnimalHealthResource::collection(
            $this->health->listFor(
                $request->user(),
                array_filter($validated, fn ($value) => $value !== null && $value !== ''),
                Pagination::perPage($validated['per_page'] ?? null),
            ),
        );
    }

    /** Overview cards and the attention worklist in one scoped aggregate. */
    public function summary(AnimalHealthRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->health->summaryFor($request->user()),
        ]);
    }

    /** Per-barangay monitoring counts and geotagged household locations. */
    public function map(AnimalHealthRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->health->mapFor($request->user()),
        ]);
    }

    /** Historical examination and animal counts for the trend chart. */
    public function trends(AnimalHealthRequest $request): JsonResponse
    {
        $validated = $request->validated();

        return response()->json([
            'data' => $this->health->trendsFor(
                $request->user(),
                $validated['from'] ?? null,
                $validated['to'] ?? null,
            ),
        ]);
    }

    /** One animal's full monitoring drawer, scoped by role. */
    public function show(AnimalHealthRequest $request, int $beneficiary): AnimalHealthDetailResource
    {
        $row = $this->health->detailFor($request->user(), $beneficiary);

        abort_unless($row, 404);

        return new AnimalHealthDetailResource($row);
    }
}
