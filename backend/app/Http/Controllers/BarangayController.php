<?php

namespace App\Http\Controllers;

use App\Models\Barangay;
use Illuminate\Http\JsonResponse;

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
}
