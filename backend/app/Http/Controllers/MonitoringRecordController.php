<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreMonitoringRecordRequest;
use App\Http\Requests\UpdateMonitoringRecordRequest;
use App\Http\Resources\MonitoringRecordResource;
use App\Models\MonitoringRecord;
use App\Services\MonitoringRecordService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

class MonitoringRecordController extends Controller
{
    public function __construct(private readonly MonitoringRecordService $records)
    {
    }

    /**
     * Role-scoped monitoring records.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        return MonitoringRecordResource::collection(
            $this->records->listFor($request->user()),
        );
    }

    /**
     * Log a visit (technician only, assigned beneficiaries only).
     */
    public function store(StoreMonitoringRecordRequest $request): JsonResponse
    {
        $record = $this->records->create($request->user(), $request->validated());

        return (new MonitoringRecordResource($record->load('beneficiary', 'technician')))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Role-scoped single fetch.
     */
    public function show(Request $request, int $id): MonitoringRecordResource
    {
        $record = $this->records->findScoped($request->user(), $id);

        abort_unless($record, Response::HTTP_NOT_FOUND);

        return new MonitoringRecordResource($record->load('beneficiary', 'technician'));
    }

    /**
     * Technician (own entries) / doctor / admin.
     */
    public function update(UpdateMonitoringRecordRequest $request, int $id): MonitoringRecordResource
    {
        $record = MonitoringRecord::findOrFail($id);

        $this->authorize('update', $record);

        return new MonitoringRecordResource(
            $this->records->update($record, $request->validated())->load('beneficiary', 'technician'),
        );
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $record = MonitoringRecord::findOrFail($id);

        $this->authorize('delete', $record);

        $this->records->delete($record);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Admin accepts a registration-created record. The "New" highlight
     * stays until the upcoming midnight; the scheduler then flips it to
     * `old` (see ExpireRegistrationRecords).
     *
     * Authorization comes before scoping on purpose: the action is
     * admin-only, so a non-admin gets 403 even for a row outside their
     * scope, while an admin's scope is already everything.
     */
    public function accept(Request $request, int $id): MonitoringRecordResource
    {
        $record = MonitoringRecord::findOrFail($id);

        $this->authorize('acceptRegistration', $record);

        return new MonitoringRecordResource(
            $this->records->accept($record, $request->user())->load(['beneficiary', 'technician', 'beneficiary.technician']),
        );
    }
}
