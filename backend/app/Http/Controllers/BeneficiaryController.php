<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreBeneficiaryRequest;
use App\Http\Resources\BeneficiaryResource;
use App\Services\BeneficiaryService;
use App\Support\Barangays;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Arr;
use Symfony\Component\HttpFoundation\Response;

class BeneficiaryController extends Controller
{
    public function __construct(private readonly BeneficiaryService $beneficiaries) {}

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
     * Address → coordinates lookup for the geo-tag picker. Authenticated
     * users only (it proxies an external service), results cached
     * server-side.
     */
    public function geocode(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'address' => ['required', 'string', 'max:255'],
        ]);

        $geo = $this->beneficiaries->geocodeFor($validated['address']);

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
    public function update(Request $request, int $id): BeneficiaryResource
    {
        $beneficiary = $this->beneficiaries->findFor($request->user(), $id);

        $this->authorize('update', $beneficiary);

        $validated = $request->validate([
            'name_of_farmer' => ['sometimes', 'string', 'max:255'],
            'address' => [
                'sometimes',
                'string',
                'max:255',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! Barangays::isCovered((string) $value)) {
                        $fail('Choose a barangay covered by the program: '.implode(', ', Barangays::all()).'.');
                    }
                },
            ],
            'animal_type' => ['sometimes', 'string', 'max:255'],
            'sex' => ['sometimes', 'in:M,F'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'technician_id' => $request->user()->role === 'admin'
                ? ['nullable', 'exists:users,id,role,technician']
                : ['prohibited'],
        ]);

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

        return new BeneficiaryResource($beneficiary->refresh());
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $beneficiary = $this->beneficiaries->findFor($request->user(), $id);

        $this->authorize('delete', $beneficiary);

        $beneficiary->delete();

        return response()->json([], Response::HTTP_NO_CONTENT);
    }
}
