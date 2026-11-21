<?php

namespace App\Http\Controllers;

use App\Http\Requests\RescheduleVaccinationRequest;
use App\Http\Requests\StoreVaccinationPhotoRequest;
use App\Http\Requests\StoreVaccinationRequest;
use App\Http\Requests\VaccinationScheduleRequest;
use App\Http\Resources\VaccinationResource;
use App\Http\Resources\VaccinationScheduleResource;
use App\Models\Vaccination;
use App\Services\AuditLogger;
use App\Services\VaccinationScheduleService;
use App\Support\ImageSanitizer;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

class VaccinationScheduleController extends Controller
{
    public function __construct(
        private readonly VaccinationScheduleService $schedule,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Role-scoped schedule, filtered and paginated before the client sees it.
     */
    public function index(VaccinationScheduleRequest $request): AnonymousResourceCollection
    {
        $validated = $request->validated();

        return VaccinationScheduleResource::collection(
            $this->schedule->listFor(
                $request->user(),
                $validated,
                Pagination::perPage($validated['per_page'] ?? null),
            ),
        );
    }

    /** Overview cards in one scoped aggregate. */
    public function summary(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->schedule->summaryFor($request->user()),
        ]);
    }

    /** Form defaults and vaccine names already used in the data. */
    public function options(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->schedule->optionsFor($request->user()),
        ]);
    }

    /** One household's completed vaccination history. */
    public function history(Request $request, int $beneficiary): AnonymousResourceCollection
    {
        return VaccinationResource::collection(
            $this->schedule->historyFor($request->user(), $beneficiary),
        );
    }

    /** Record a completed vaccination from the schedule row. */
    public function store(StoreVaccinationRequest $request): JsonResponse
    {
        $vaccination = $this->schedule->recordFor(
            $request->user(),
            (int) $request->validated('beneficiary_id'),
            $request->validated(),
        );

        return (new VaccinationResource($vaccination->load(['beneficiary', 'technician'])))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /** Move the next-due date without rewriting the history. */
    public function reschedule(RescheduleVaccinationRequest $request, int $beneficiary): VaccinationScheduleResource
    {
        $household = $this->schedule->rescheduleFor($request->user(), $beneficiary, $request->validated());
        $row = $this->schedule->scheduleRowFor($request->user(), $household->id);

        abort_unless($row, Response::HTTP_NOT_FOUND);

        return new VaccinationScheduleResource($row);
    }

    /** Attach/replace the private supporting photo for one administration. */
    public function storePhoto(StoreVaccinationPhotoRequest $request, int $id): VaccinationResource
    {
        $vaccination = Vaccination::findOrFail($id);
        $sanitized = ImageSanitizer::sanitizeToUpload($request->file('image'));
        $path = ImageSanitizer::storeImage($sanitized, "vaccinations/{$vaccination->id}");

        if ($vaccination->photo_path) {
            Storage::disk('secure')->delete($vaccination->photo_path);
        }

        $vaccination->forceFill(['photo_path' => $path])->save();
        $this->audit->log($request->user(), 'vaccination_photo_uploaded', $vaccination);

        return new VaccinationResource($vaccination->load(['beneficiary', 'technician']));
    }
}
