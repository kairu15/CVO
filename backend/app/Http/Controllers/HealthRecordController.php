<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreHealthRecordRequest;
use App\Http\Requests\UpdateHealthRecordRequest;
use App\Http\Resources\HealthRecordResource;
use App\Models\HealthRecord;
use App\Services\HealthRecordService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

class HealthRecordController extends Controller
{
    public function __construct(private readonly HealthRecordService $records) {}

    /**
     * Role-scoped clinical health records.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        return HealthRecordResource::collection(
            $this->records->listFor($request->user()),
        );
    }

    /**
     * Author a health record (veterinarian only).
     */
    public function store(StoreHealthRecordRequest $request): JsonResponse
    {
        $record = $this->records->create($request->user(), $request->validated());

        return (new HealthRecordResource($record->load(['beneficiary', 'doctor'])))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Role-scoped single fetch.
     */
    public function show(Request $request, int $id): HealthRecordResource
    {
        $record = $this->records->findScoped($request->user(), $id);

        abort_unless($record, Response::HTTP_NOT_FOUND);

        return new HealthRecordResource($record);
    }

    /**
     * Authoring veterinarian / admin.
     */
    public function update(UpdateHealthRecordRequest $request, int $id): HealthRecordResource
    {
        $record = HealthRecord::findOrFail($id);

        $this->authorize('update', $record);

        return new HealthRecordResource(
            $this->records->update($record, $request->validated())->load(['beneficiary', 'doctor']),
        );
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $record = HealthRecord::findOrFail($id);

        $this->authorize('delete', $record);

        $this->records->delete($record);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * The vocabulary the doctor's form offers. Served from config/cvo.php so
     * the dropdown and the server-side validation can never drift apart.
     */
    public function options(): JsonResponse
    {
        return response()->json([
            'data' => [
                'outcomes' => config('cvo.health_outcomes'),
            ],
        ]);
    }
}
