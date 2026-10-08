<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\BulkDeletes;
use App\Http\Requests\BulkDeleteRequest;
use App\Http\Requests\StoreFieldVisitPhotoRequest;
use App\Http\Requests\StoreFieldVisitRequest;
use App\Http\Requests\UpdateFieldVisitRequest;
use App\Http\Resources\FieldVisitPhotoResource;
use App\Http\Resources\FieldVisitResource;
use App\Models\FieldVisit;
use App\Models\FieldVisitPhoto;
use App\Models\User;
use App\Models\UserNotification;
use App\Services\NotificationService;
use App\Services\AuditLogger;
use App\Services\FieldVisitService;
use App\Services\SettingsService;
use App\Support\ImageSanitizer;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

class FieldVisitController extends Controller
{
    use BulkDeletes;

    public function __construct(
        private readonly FieldVisitService $visits,
        private readonly NotificationService $notifications,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Role-scoped field visits.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        return FieldVisitResource::collection(
            $this->visits->listFor(
                $request->user(),
                Pagination::perPage($request->input('per_page')),
            ),
        );
    }

    /**
     * Log a trip (technician only).
     */
    public function store(StoreFieldVisitRequest $request): JsonResponse
    {
        $visit = $this->visits->create($request->user(), $request->validated());

        return (new FieldVisitResource($visit->load(['beneficiary', 'technician'])))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Role-scoped single fetch.
     */
    public function show(Request $request, int $id): FieldVisitResource
    {
        $visit = $this->visits->findScoped($request->user(), $id);

        abort_unless($visit, Response::HTTP_NOT_FOUND);

        return new FieldVisitResource($visit);
    }

    /**
     * The visiting technician / admin.
     */
    public function update(UpdateFieldVisitRequest $request, int $id): FieldVisitResource
    {
        $visit = FieldVisit::findOrFail($id);

        $this->authorize('update', $visit);

        return new FieldVisitResource(
            $this->visits->update($request->user(), $visit, $request->validated())->load(['beneficiary', 'technician']),
        );
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $visit = FieldVisit::findOrFail($id);

        $this->authorize('delete', $visit);

        $this->visits->delete($request->user(), $visit);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Delete many field visits in one request (the table's bulk action).
     */
    public function bulkDestroy(BulkDeleteRequest $request): JsonResponse
    {
        return $this->bulkDelete(
            $request,
            FieldVisit::class,
            fn (FieldVisit $visit) => $this->visits->delete($request->user(), $visit),
        );
    }

    /**
     * The purpose vocabulary the field form offers, served from
     * SettingsService so the dropdown and the server-side validation cannot
     * drift, and an admin-managed purpose is offered as soon as it is saved.
     */
    public function options(): JsonResponse
    {
        return response()->json([
            'data' => [
                'purposes' => app(SettingsService::class)->fieldVisitPurposes(),
            ],
        ]);
    }

    /**
     * Attach a geotagged photo to a visit (the capturing technician only).
     *
     * The image arrives already composited (metadata panel burned into the
     * pixels) and downscaled client-side; every structured field from the
     * capture moment arrives alongside it and is stored as real columns —
     * the pixels are evidence, the columns are the data.
     *
     * A retake replaces the previous photo (and deletes its file) rather
     * than appending a second one.
     */
    public function storePhoto(StoreFieldVisitPhotoRequest $request, int $id): JsonResponse
    {
        // Authorization + every image/metadata rule live on the FormRequest
        // (items 5 and 8): content-sniffed MIME, extension allow-list, size
        // cap, bounded metadata fields.
        $visit = FieldVisit::findOrFail($id);

        $validated = $request->validated();

        // Item 8: strip EXIF (device serials, embedded thumbnails, accidental
        // GPS in the bytes — the structured columns below carry the intended
        // geotag) via GD re-encode, then store under a server-generated
        // random name on the PRIVATE disk. The client's filename is never
        // used. A file that passes validation but cannot be decoded answers
        // 422 (ValidationException from the sanitizer).
        $sanitized = ImageSanitizer::sanitizeToUpload($request->file('image'));
        $sanitizedPath = ImageSanitizer::storeImage($sanitized, "field-visits/{$visit->id}");

        // A retake replaces: the old row goes and its file with it.
        $previous = $visit->photos()->latest('id')->first();
        if ($previous) {
            Storage::disk('secure')->delete($previous->image_path);
            $previous->delete();
        }

        $photo = $visit->photos()->create([
            'technician_id' => $request->user()->id,
            'image_path' => $sanitizedPath,
            ...$validated,
        ]);

        $this->audit->log($request->user(), 'field_visit_photo_uploaded', $photo);

        // Evidence was just submitted — tell the supervisors who review this
        // household: admins for oversight, doctors because the photo carries
        // the animal's condition they triage on. The technician's own visit
        // needs no self-alert.
        $supervisors = User::query()->whereIn('role', ['admin', 'doctor'])->get();

        foreach ($supervisors as $admin) {
            $this->notifications->create($admin, [
                'type' => UserNotification::TYPE_FIELD_VISIT_PHOTO,
                'actor_id' => $request->user()->id,
                'beneficiary_id' => $visit->beneficiary_id,
                'title' => 'Field visit photo submitted',
                'message' => "{$request->user()->name} submitted a geotagged photo for {$visit->beneficiary->name_of_farmer} in {$visit->beneficiary->address}.",
                'link' => '/dashboard/admin/monitoring',
            ]);
        }

        return (new FieldVisitPhotoResource($photo))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Remove a visit's photo (the capturing technician or an admin).
     */
    public function destroyPhoto(Request $request, int $id): Response
    {
        $visit = FieldVisit::findOrFail($id);

        $this->authorize('update', $visit);

        $photo = $visit->photos()->latest('id')->first();

        if ($photo) {
            Storage::disk('secure')->delete($photo->image_path);
            $photo->delete();

            $this->audit->log($request->user(), 'field_visit_photo_deleted', $photo);
        }

        return response()->noContent();
    }
}
