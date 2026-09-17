<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreBeneficiaryRequest;
use App\Http\Resources\BeneficiaryResource;
use App\Services\BeneficiaryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

class BeneficiaryController extends Controller
{
    public function __construct(private readonly BeneficiaryService $beneficiaries)
    {
    }

    /**
     * Role-scoped beneficiary list.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        return BeneficiaryResource::collection(
            $this->beneficiaries->listFor($request->user()),
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
     * Role-scoped single fetch.
     */
    public function show(Request $request, int $id): BeneficiaryResource
    {
        $beneficiary = $this->beneficiaries->scopeQueryFor($request->user())
            ->with(['technician', 'farmer'])
            ->withCount('monitoringRecords')
            ->findOrFail($id);

        return new BeneficiaryResource($beneficiary);
    }

    /**
     * Admin reassigns technicians; farmers may correct their own details.
     */
    public function update(Request $request, int $id): BeneficiaryResource
    {
        $beneficiary = $this->beneficiaries->scopeQueryFor($request->user())->findOrFail($id);

        $this->authorize('update', $beneficiary);

        $validated = $request->validate([
            'name_of_farmer' => ['sometimes', 'string', 'max:255'],
            'address' => ['sometimes', 'string', 'max:255'],
            'animal_type' => ['sometimes', 'string', 'max:255'],
            'sex' => ['sometimes', 'in:M,F'],
            'technician_id' => $request->user()->role === 'admin'
                ? ['nullable', 'exists:users,id,role,technician']
                : ['prohibited'],
        ]);

        $beneficiary->update($validated);

        return new BeneficiaryResource($beneficiary->refresh());
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $beneficiary = $this->beneficiaries->scopeQueryFor($request->user())->findOrFail($id);

        $this->authorize('delete', $beneficiary);

        $beneficiary->delete();

        return response()->json([], Response::HTTP_NO_CONTENT);
    }
}
