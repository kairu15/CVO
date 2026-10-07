<?php

namespace App\Http\Controllers;

use App\Http\Requests\AdminBarangayStoreRequest;
use App\Http\Requests\AdminBarangayUpdateRequest;
use App\Http\Requests\AdminPurokStoreRequest;
use App\Http\Requests\AdminPurokUpdateRequest;
use App\Http\Requests\NearestBarangayRequest;
use App\Models\Barangay;
use App\Models\Purok;
use App\Services\AuditLogger;
use App\Support\Geo;
use Illuminate\Http\JsonResponse;

/**
 * Location reference data — the public registration cascade's source, plus
 * the admin half that keeps it current.
 *
 * The public half is read-only and session-free by design: the register form
 * needs the barangay → purok cascade before the visitor has an account, so
 * those endpoints live outside the authenticated group (see routes/api.php).
 * Only reference geometry leaves the server here — never user data.
 *
 * The admin half manages the reference data itself, with one hard rule:
 *
 * - A PUROK can be added, renamed and (when unused) deleted freely. It is
 *   FK-referenced by beneficiaries.purok_id, so a rename follows the rows —
 *   history keeps pointing at the same purok, under its new name.
 *
 * - A BARANGAY can be added and re-centered but never renamed. The
 *   free-text beneficiary address normalizes against the barangay list
 *   (App\Support\Barangays::normalize), so renaming orphans every historical
 *   row that spells it the old way.
 */
class BarangayController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

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
     * Add a coverage area. New barangays append to the list (ordered by id),
     * appear in every dropdown through App\Support\Barangays, and accept
     * beneficiaries immediately.
     */
    public function store(AdminBarangayStoreRequest $request): JsonResponse
    {
        $barangay = Barangay::create($request->validated());

        $this->audit->log($request->user(), 'reference_data_updated', $barangay, [
            'operation' => 'barangay_created',
            'name' => $barangay->name,
        ]);

        return response()->json([
            'data' => ['barangay' => $this->barangayPayload($barangay)],
        ], 201);
    }

    /**
     * Re-center a barangay. The name is immutable (see class docblock).
     */
    public function update(AdminBarangayUpdateRequest $request, Barangay $barangay): JsonResponse
    {
        $barangay->update($request->validated());

        $this->audit->log($request->user(), 'reference_data_updated', $barangay, [
            'operation' => 'barangay_updated',
            'name' => $barangay->name,
        ]);

        return response()->json([
            'data' => ['barangay' => $this->barangayPayload($barangay)],
        ]);
    }

    /**
     * Record a real purok/sitio inside one barangay — typically replacing a
     * seeded placeholder once the CVO supplies the real list.
     */
    public function storePurok(AdminPurokStoreRequest $request, Barangay $barangay): JsonResponse
    {
        $purok = $barangay->puroks()->create($request->validated());

        $this->audit->log($request->user(), 'reference_data_updated', $purok, [
            'operation' => 'purok_created',
            'barangay' => $barangay->name,
            'name' => $purok->name,
        ]);

        return response()->json([
            'data' => ['purok' => $this->purokPayload($purok)],
        ], 201);
    }

    /**
     * Rename or re-center one purok.
     */
    public function updatePurok(AdminPurokUpdateRequest $request, Purok $purok): JsonResponse
    {
        $purok->update($request->validated());

        $this->audit->log($request->user(), 'reference_data_updated', $purok, [
            'operation' => 'purok_updated',
            'barangay' => $purok->barangay->name,
            'name' => $purok->name,
        ]);

        return response()->json([
            'data' => ['purok' => $this->purokPayload($purok)],
        ]);
    }

    /**
     * Delete a purok — only when no household is located in it. A used purok
     * is history, not garbage: answering 409 names the conflict instead of
     * cascading a delete through beneficiaries.
     */
    public function destroyPurok(Purok $purok): JsonResponse
    {
        if ($purok->beneficiaries()->exists()) {
            abort(409, 'This purok still has households registered in it and cannot be deleted.');
        }

        $name = $purok->name;
        $barangayName = $purok->barangay->name;
        $purok->delete();

        $this->audit->log(auth()->user(), 'reference_data_updated', Purok::class, [
            'operation' => 'purok_deleted',
            'barangay' => $barangayName,
            'name' => $name,
        ]);

        return response()->json(['data' => ['deleted' => true]]);
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
    public function nearest(NearestBarangayRequest $request): JsonResponse
    {
        $validated = $request->validated();

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
    public function nearestPurok(NearestBarangayRequest $request, Barangay $barangay): JsonResponse
    {
        $validated = $request->validated();

        $match = Geo::nearestPurok(
            (float) $validated['latitude'],
            (float) $validated['longitude'],
            $barangay->id,
        );

        return response()->json(['data' => $match]);
    }

    /**
     * @return array<string, mixed>
     */
    private function barangayPayload(Barangay $barangay): array
    {
        return [
            'id' => $barangay->id,
            'name' => $barangay->name,
            'latitude' => (float) $barangay->latitude,
            'longitude' => (float) $barangay->longitude,
            'puroks' => $barangay->relationLoaded('puroks')
                ? $barangay->puroks->map(fn (Purok $p) => $this->purokPayload($p))->all()
                : $barangay->puroks()->get()->map(fn (Purok $p) => $this->purokPayload($p))->all(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function purokPayload(Purok $purok): array
    {
        return [
            'id' => $purok->id,
            'barangay_id' => $purok->barangay_id,
            'name' => $purok->name,
            'latitude' => $purok->latitude !== null ? (float) $purok->latitude : null,
            'longitude' => $purok->longitude !== null ? (float) $purok->longitude : null,
            'is_placeholder' => (bool) $purok->is_placeholder,
        ];
    }
}
