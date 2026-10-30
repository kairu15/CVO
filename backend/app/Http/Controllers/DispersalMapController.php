<?php

namespace App\Http\Controllers;

use App\Http\Requests\DispersalMapDatesRequest;
use App\Http\Requests\DispersalMapRequest;
use App\Services\DispersalMapService;
use Illuminate\Http\JsonResponse;

/**
 * The dispersal map's HTTP surface — the dated, animal-keyed snapshot the
 * Dispersal Map page renders as pins plus barangay polygons.
 *
 * Read-only and entirely derived, like the analytics controllers: the only
 * way to change an answer is to record, void or edit an event. Access is the
 * view_flight_path capability (route middleware + the FormRequest); row
 * scoping lives in DispersalMapService's queries, so every consumer gets the
 * same boundary.
 *
 * The pins endpoint returns PINS and BARANGAY COUNTS together on purpose:
 * one snapshot, so the polygons can never disagree with the pins they
 * summarize — the barangay-counts question is answered by the same call
 * rather than by a second endpoint racing the first.
 */
class DispersalMapController extends Controller
{
    public function __construct(private readonly DispersalMapService $map) {}

    /**
     * The dates that have records, newest first, for the date selector's
     * dropdown and calendar highlights.
     */
    public function dates(DispersalMapDatesRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->map->dates(
                $request->user(),
                $request->window(),
                (int) $request->query('page', '1'),
                (int) $request->query('per_page', '60'),
            ),
        ]);
    }

    /** The pins + per-barangay counts for one date and mode. */
    public function pins(DispersalMapRequest $request): JsonResponse
    {
        ['date' => $date, 'mode' => $mode] = $request->snapshotFilters();

        return response()->json([
            'data' => $this->map->snapshot($request->user(), $date, $mode),
        ]);
    }
}
