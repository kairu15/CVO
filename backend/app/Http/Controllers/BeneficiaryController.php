<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\BulkDeletes;
use App\Http\Requests\BulkDeleteRequest;
use App\Http\Requests\GeocodeRequest;
use App\Http\Requests\IndexBeneficiariesRequest;
use App\Http\Requests\StoreBeneficiaryRequest;
use App\Http\Requests\UpdateBeneficiaryRequest;
use App\Http\Resources\BeneficiaryResource;
use App\Services\BeneficiaryService;
use App\Support\Barangays;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class BeneficiaryController extends Controller
{
    use BulkDeletes;

    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
    ) {}

    /**
     * Role-scoped beneficiary list. `per_page` is clamped to 50 by
     * App\Support\Pagination, so no response carries more than 50 households.
     */
    public function index(IndexBeneficiariesRequest $request): AnonymousResourceCollection
    {
        return BeneficiaryResource::collection(
            $this->beneficiaries->listFor(
                $request->user(),
                Pagination::perPage($request->validated('per_page') ?? null),
                $request->safe()->only(['search', 'barangay']),
            ),
        );
    }

    /**
     * Add a beneficiary — the admin asserting this household is enrolled.
     * Auto-creates the linked monitoring record (see BeneficiaryService).
     */
    public function store(StoreBeneficiaryRequest $request): JsonResponse
    {
        $beneficiary = $this->beneficiaries->create($request->user(), $request->validated());

        return (new BeneficiaryResource($beneficiary))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Address → coordinates lookup for the geo-tag picker. Authenticated
     * users only (it proxies an external service), results cached
     * server-side.
     */
    public function geocode(GeocodeRequest $request): JsonResponse
    {
        $geo = $this->beneficiaries->geocodeFor($request->validated('address'));

        return response()->json(['data' => $geo]);
    }

    /**
     * Role-scoped single fetch. A technician pointing at an unassigned
     * beneficiary gets 403 (a permissions boundary); everyone else gets the
     * usual 404 for out-of-scope rows.
     */
    public function show(Request $request, int $id): BeneficiaryResource
    {
        $beneficiary = $this->beneficiaries->findFor($request->user(), $id);
        $beneficiary->load('technician')
            ->loadCount('monitoringRecords');

        return new BeneficiaryResource($beneficiary);
    }

    /**
     * One animal's chronological location history for the dispersal map's
     * flight-path trail: origin → GPS-tagged field visits → current pin.
     * Read-only, and scoped exactly like show() (BeneficiaryService::pathFor):
     * a technician whose assignment excludes the row answers 403, a missing
     * row 404.
     */
    public function path(Request $request, int $id): JsonResponse
    {
        return response()->json([
            'data' => $this->beneficiaries->pathFor($request->user(), $id),
        ]);
    }

    /**
     * Staff maintain the record; the admin also reassigns technicians.
     */
    public function update(UpdateBeneficiaryRequest $request, int $id): BeneficiaryResource
    {
        $beneficiary = $this->beneficiaries->findFor($request->user(), $id);

        $this->authorize('update', $beneficiary);

        $validated = $request->validated();

        // Address changed without an explicit new pin? Re-resolve the
        // coordinates so the map marker follows the corrected barangay.
        if (Arr::has($validated, 'address') && ! Arr::has($validated, 'latitude')) {
            $validated['address'] = Barangays::normalize($validated['address']);
            $geo = $this->beneficiaries->geocodeFor($validated['address']);

            if ($geo) {
                $validated['latitude'] = $geo['lat'];
                $validated['longitude'] = $geo['lng'];
            }
        }

        // One transaction: the change and the audit row it writes through
        // App\Models\Concerns\Auditable commit together (or neither does).
        DB::transaction(fn () => $beneficiary->update($validated));

        return new BeneficiaryResource($beneficiary->refresh());
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $beneficiary = $this->beneficiaries->findFor($request->user(), $id);

        $this->authorize('delete', $beneficiary);

        // Soft-deletes the household AND its whole history (visits, clinical
        // records, monitoring rows, assignments, notifications) in one
        // transaction. A bare $beneficiary->delete() left every related row
        // orphaned (and failed outright on any monitoring record, whose FK
        // carries no cascade).
        $this->beneficiaries->deleteBeneficiary($request->user(), $beneficiary);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Delete many households in one request (the directory's bulk action).
     * Admin-only by policy; each household still soft-deletes its whole
     * history through the same service the single delete uses.
     */
    public function bulkDestroy(BulkDeleteRequest $request): JsonResponse
    {
        return $this->bulkDelete(
            $request,
            \App\Models\Beneficiary::class,
            fn (\App\Models\Beneficiary $beneficiary) => $this->beneficiaries->deleteBeneficiary($request->user(), $beneficiary),
        );
    }
}
