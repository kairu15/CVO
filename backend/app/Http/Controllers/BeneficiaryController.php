<?php

namespace App\Http\Controllers;

use App\Http\Requests\GeocodeRequest;
use App\Http\Requests\IndexBeneficiariesRequest;
use App\Http\Requests\StoreBeneficiaryRequest;
use App\Http\Requests\UpdateBeneficiaryRequest;
use App\Http\Resources\BeneficiaryResource;
use App\Services\AuditLogger;
use App\Services\BeneficiaryService;
use App\Support\Barangays;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Arr;
use Symfony\Component\HttpFoundation\Response;

class BeneficiaryController extends Controller
{
    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Role-scoped beneficiary list. `per_page` is honoured (capped at 500 by
     * the request) so map/dashboard/picker callers see every household the
     * monitoring table reports on, not just the first 15.
     */
    public function index(IndexBeneficiariesRequest $request): AnonymousResourceCollection
    {
        return BeneficiaryResource::collection(
            $this->beneficiaries->listFor(
                $request->user(),
                $request->integer('per_page', 15),
            ),
        );
    }

    /**
     * Create a beneficiary (farmer registration / staff registering on
     * behalf of a farmer).
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
        $beneficiary->load(['technician', 'farmer'])
            ->loadCount('monitoringRecords');

        return new BeneficiaryResource($beneficiary);
    }

    /**
     * Admin reassigns technicians; farmers may correct their own details.
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

        $beneficiary->update($validated);

        $this->audit->log($request->user(), 'beneficiary_updated', $beneficiary);

        return new BeneficiaryResource($beneficiary->refresh());
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $beneficiary = $this->beneficiaries->findFor($request->user(), $id);

        $this->authorize('delete', $beneficiary);

        // Soft-deletes the household AND its whole history (visits, clinical
        // records, monitoring rows, assignments, notifications) plus the
        // farmer account when it has no other households — all in one
        // transaction. A bare $beneficiary->delete() left every related row
        // orphaned (and failed outright on any monitoring record, whose FK
        // carries no cascade).
        $this->beneficiaries->deleteFarmer($request->user(), $beneficiary);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }
}
