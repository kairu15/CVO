<?php

namespace App\Http\Controllers;

use App\Services\PublicMapService;
use Illuminate\Http\JsonResponse;

/**
 * Public (unauthenticated) program statistics for the landing page map.
 *
 * Read-only and aggregate-only — see PublicMapService for the privacy
 * boundary and the backend test that enforces it.
 */
class PublicMapController extends Controller
{
    public function __construct(private readonly PublicMapService $map) {}

    public function summary(): JsonResponse
    {
        return response()->json(['data' => $this->map->summary()]);
    }
}
