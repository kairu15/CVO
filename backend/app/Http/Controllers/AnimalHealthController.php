<?php

namespace App\Http\Controllers;

use App\Http\Requests\AnimalHealthRequest;
use App\Http\Resources\AnimalHealthResource;
use App\Services\AnimalHealthService;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Animal health rollup — read-only, aggregated from existing records.
 *
 * No store/update/destroy and no backing table: this endpoint reports facts
 * that are already stored against an animal (its visits, clinical events,
 * notes and vaccination state). Recording any of them happens on the module
 * that owns that record.
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
                ($validated['filter'] ?? null) === 'attention',
                (int) ($validated['per_page'] ?? 15),
            ),
        );
    }
}
