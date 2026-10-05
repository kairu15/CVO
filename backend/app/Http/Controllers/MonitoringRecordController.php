<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\BulkDeletes;
use App\Http\Requests\BulkDeleteRequest;
use App\Http\Requests\IndexMonitoringRecordsRequest;
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
    use BulkDeletes;

    public function __construct(private readonly MonitoringRecordService $records)
    {
    }

    /**
     * Role-scoped monitoring records, optionally bucketed to one month.
     *
     * The month/year filter and the farmer-name search both run here,
     * server-side: `month=YYYY-MM` bucketed on `date_monitored` (the field
     * the CVO report is organized by) and `search` matched against the
     * beneficiary's name — each BEFORE pagination, so `meta.total` is the
     * filter's real row count, not a page-sized slice of a pre-filtered
     * fetch. `per_page` lets the UI raise the page size; `page` paginates.
     */
    public function index(IndexMonitoringRecordsRequest $request): AnonymousResourceCollection
    {
        $paginator = $this->records->listFor(
            $request->user(),
            $request->validated('month'),
            $request->validated('search'),
            (int) $request->validated('per_page'),
            $request->validated('animal_type'),
            $request->validated('sort') ?? 'date',
        );

        return MonitoringRecordResource::collection($paginator);
    }

    /**
     * The months that actually have monitoring records, scoped to the
     * caller — the month/year tab list. Only months with data appear and
     * they arrive oldest → newest, one cheap query over the indexed
     * `date_monitored` column.
     */
    public function months(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->records->availableMonthsFor($request->user()),
        ]);
    }

    /**
     * The distinct animal types actually present in the caller's records,
     * alphabetical — the animal-type filter's option list. Derived from the
     * data (not a hardcoded list), so it reflects whatever the imported
     * workbooks and UI registrations produced.
     */
    public function animalTypes(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->records->availableAnimalTypesFor($request->user()),
        ]);
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
            $this->records->update($request->user(), $record, $request->validated())->load('beneficiary', 'technician'),
        );
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $record = MonitoringRecord::findOrFail($id);

        $this->authorize('delete', $record);

        $this->records->delete($request->user(), $record);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Delete many records in one request (the table's bulk action). Each row
     * is authorized individually; a registration row still soft-deletes its
     * whole farmer through the service, exactly like the single delete.
     */
    public function bulkDestroy(BulkDeleteRequest $request): JsonResponse
    {
        return $this->bulkDelete(
            $request,
            MonitoringRecord::class,
            fn (MonitoringRecord $record) => $this->records->delete($request->user(), $record),
        );
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
