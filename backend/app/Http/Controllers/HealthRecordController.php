<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\BulkDeletes;
use App\Http\Requests\BulkDeleteRequest;
use App\Http\Requests\StoreHealthRecordPhotoRequest;
use App\Http\Requests\StoreHealthRecordRequest;
use App\Http\Requests\UpdateHealthRecordRequest;
use App\Http\Resources\HealthRecordResource;
use App\Models\HealthRecord;
use App\Services\AuditLogger;
use App\Services\HealthRecordService;
use App\Services\SettingsService;
use App\Support\ImageSanitizer;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class HealthRecordController extends Controller
{
    use BulkDeletes;

    public function __construct(
        private readonly HealthRecordService $records,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Role-scoped clinical health records, filtered before pagination.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $validated = $request->validate([
            'search' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', Rule::in([
                'healthy', 'observation', 'follow_up', 'overdue', 'upcoming', 'completed',
            ])],
            'barangay' => ['nullable', 'string', 'max:120'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'sort' => ['nullable', Rule::in(['date', 'farmer'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
        ]);

        return HealthRecordResource::collection(
            $this->records->listFor(
                $request->user(),
                Pagination::perPage($request->input('per_page')),
                array_filter($validated, fn ($value) => $value !== null && $value !== ''),
            ),
        );
    }

    /**
     * Overview cards + follow-up counters in one scoped aggregate.
     */
    public function summary(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->records->summaryFor($request->user()),
        ]);
    }

    /**
     * Author a health record (technician only).
     */
    public function store(StoreHealthRecordRequest $request): JsonResponse
    {
        $record = $this->records->create($request->user(), $request->validated());

        return (new HealthRecordResource($record->load(['beneficiary', 'doctor'])))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Role-scoped single fetch plus the beneficiary's examination history for
     * the detail drawer.
     */
    public function show(Request $request, int $id): HealthRecordResource
    {
        $record = $this->records->findScoped($request->user(), $id);

        abort_unless($record, Response::HTTP_NOT_FOUND);

        $record->load([
            'doctor',
            'beneficiary' => fn ($query) => $query->with([
                'healthRecords' => fn ($history) => $history
                    ->with('doctor')
                    ->orderByDesc('date_recorded')
                    ->orderByDesc('id'),
            ]),
        ]);

        $resource = new HealthRecordResource($record);
        $resource->includeHistory = true;

        return $resource;
    }

    /**
     * Authoring veterinarian / admin.
     */
    public function update(UpdateHealthRecordRequest $request, int $id): HealthRecordResource
    {
        $record = HealthRecord::findOrFail($id);

        $this->authorize('update', $record);

        return new HealthRecordResource(
            $this->records->update($request->user(), $record, $request->validated())
                ->load(['beneficiary', 'doctor']),
        );
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $record = HealthRecord::findOrFail($id);

        $this->authorize('delete', $record);

        $this->records->delete($request->user(), $record);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Delete many health records in one request (the table's bulk action).
     */
    public function bulkDestroy(BulkDeleteRequest $request): JsonResponse
    {
        return $this->bulkDelete(
            $request,
            HealthRecord::class,
            fn (HealthRecord $record) => $this->records->delete($request->user(), $record),
        );
    }

    /**
     * Attach/replace the one supporting clinical photo. Like field-visit
     * photos, the image is re-encoded to strip metadata and stored on the
     * private disk under a server-generated name.
     */
    public function storePhoto(StoreHealthRecordPhotoRequest $request, int $id): HealthRecordResource
    {
        $record = HealthRecord::findOrFail($id);

        $sanitized = ImageSanitizer::sanitizeToUpload($request->file('image'));
        $path = ImageSanitizer::storeImage($sanitized, "health-records/{$record->id}");

        if ($record->photo_path) {
            Storage::disk('secure')->delete($record->photo_path);
        }

        $record->forceFill(['photo_path' => $path])->save();

        $this->audit->log($request->user(), 'health_record_photo_uploaded', $record);

        return new HealthRecordResource($record->load(['beneficiary', 'doctor']));
    }

    /**
     * The vocabulary the clinical form offers. Served from SettingsService so
     * the dropdown and the server-side validation can never drift apart, and
     * an outcome an admin adds is offered as soon as it is saved.
     */
    public function options(): JsonResponse
    {
        return response()->json([
            'data' => [
                'outcomes' => app(SettingsService::class)->healthOutcomes(),
            ],
        ]);
    }
}
