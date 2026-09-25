<?php

namespace App\Http\Controllers;

use App\Models\Barangay;
use App\Support\Geo;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public location reference data — the registration cascade's source.
 *
 * Read-only and session-free by design: the register form needs the
 * barangay → purok cascade before the visitor has an account, so these
 * endpoints live outside the authenticated group (see routes/api.php).
 * Only reference geometry leaves the server here — never user data.
 */
class BarangayController extends Controller
{
    /**
     * Every covered barangay with its map center. Ids lead the payload so
     * the client can key the purok fetch off the chosen barangay.
     */
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => Barangay::query()
                ->orderBy('id')
                ->get(['id', 'name', 'latitude', 'longitude']),
        ]);
    }

    /**
     * The puroks/sitios inside one barangay, for the second select.
     *
     * `is_placeholder` rides along so the client can flag seeded stand-ins
     * until the CVO supplies the real purok list.
     */
    public function puroks(Barangay $barangay): JsonResponse
    {
        return response()->json([
            'data' => $barangay->puroks()
                ->orderBy('name')
                ->get(['id', 'barangay_id', 'name', 'latitude', 'longitude', 'is_placeholder']),
        ]);
    }

    /**
     * Nearest-centroid barangay match for a GPS fix or dropped map pin.
     *
     * IMPORTANT: this is NOT boundary containment — the program stores
     * center points, not polygons (see App\Support\Geo). The client must
     * present the result as a suggestion the farmer confirms, never as a
     * silent assignment. `distance_km` lets the client show how far the
     * fix sat from the matched center, a hint at how much to trust it.
     */
    public function nearest(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $match = Geo::nearestBarangay(
            (float) $validated['latitude'],
            (float) $validated['longitude'],
        );

        // A miss (no covered center within reach) is a normal outcome —
        // the farmer may stand outside the seeded city or on a bad fix —
        // so it answers 200 with null data, not an error.
        return response()->json(['data' => $match]);
    }

    /**
     * Nearest purok center within ONE barangay for a moved map pin. Scoped
     * to the barangay so a pin can never suggest a purok from a neighbouring
     * one. Same nearest-centroid caveat as `nearest` above.
     */
    public function nearestPurok(Request $request, Barangay $barangay): JsonResponse
    {
        $validated = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $match = Geo::nearestPurok(
            (float) $validated['latitude'],
            (float) $validated['longitude'],
            $barangay->id,
        );

        return response()->json(['data' => $match]);
    }
}
