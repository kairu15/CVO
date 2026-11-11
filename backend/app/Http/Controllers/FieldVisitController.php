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
use App\Services\FieldVisitVerificationService;
use App\Services\SettingsService;
use App\Support\ImageSanitizer;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FieldVisitController extends Controller
{
    use BulkDeletes;

    public function __construct(
        private readonly FieldVisitService $visits,
        private readonly NotificationService $notifications,
        private readonly AuditLogger $audit,
        private readonly FieldVisitVerificationService $verification,
    ) {}

    /**
     * Role-scoped field visits, optionally narrowed to one on-site verdict
     * (or the `review` bucket) by the `verification` query parameter.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $this->validatedFilters($request);
        $verification = $filters['verification'] ?? 'all';
        unset($filters['verification']);

        return FieldVisitResource::collection(
            $this->visits->listFor(
                $request->user(),
                Pagination::perPage($request->input('per_page')),
                $verification,
                $filters,
            ),
        );
    }

    /** The stat strip — one scoped aggregate request, no rows. */
    public function summary(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->visits->summaryFor($request->user()),
        ]);
    }

    /**
     * Assigned households with no monitoring or visit inside the 60-day
     * window, plus per-technician coverage. Derived, never stored.
     */
    public function visitsDue(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'follow_up' => ['nullable', 'boolean'],
        ]);

        return response()->json([
            'data' => $this->visits->visitsDueFor(
                $request->user(),
                (bool) ($validated['follow_up'] ?? false),
            ),
        ]);
    }

    /**
     * The filtered log as a CSV for monthly CVO reporting (UTF-8 BOM so
     * Excel opens barangay names correctly).
     */
    public function export(Request $request): StreamedResponse
    {
        $filters = $this->validatedFilters($request);
        $verification = $filters['verification'] ?? 'all';
        unset($filters['verification']);

        $this->audit->log($request->user(), 'exported', null, [
            'resource' => 'field_visit_log',
            'filters' => $filters,
        ]);

        $filename = 'field-visits-'.now()->format('Ymd-His').'.csv';

        return response()->streamDownload(function () use ($request, $verification, $filters): void {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");

            fputcsv($out, [
                'Date', 'Farmer', 'RSBSA #', 'Ear Tag #', 'Barangay', 'Animal',
                'Purpose', 'Technician', 'Verification', 'Distance (m)',
                'Dispersal Date', 'Dispersal Type', 'Notes',
            ]);

            foreach ($this->visits->rowsFor($request->user(), $verification, $filters) as $visit) {
                fputcsv($out, [
                    $visit->visited_on?->toDateString(),
                    $visit->beneficiary?->name_of_farmer,
                    $visit->beneficiary?->rsbsa_number,
                    $visit->beneficiary?->ear_tag_number,
                    $visit->beneficiary?->address,
                    $visit->beneficiary?->animal_type,
                    $visit->purpose ? str_replace('-', ' ', ucfirst($visit->purpose)) : '',
                    $visit->technician?->name,
                    $visit->verification_status,
                    $visit->distance_m,
                    $visit->dispersalEvent?->date_dispersed?->toDateString(),
                    $visit->dispersalEvent?->dispersal_type,
                    $visit->notes,
                ]);
            }

            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /**
     * The validated filter set. `verification` is checked against the same
     * vocabulary the verdict service uses, so an unknown bucket is a 422
     * rather than a silently unfiltered list.
     *
     * @return array<string, mixed>
     */
    private function validatedFilters(Request $request): array
    {
        $validated = $request->validate([
            'verification' => ['nullable', 'string', Rule::in(FieldVisitVerificationService::FILTERS)],
            'search' => ['nullable', 'string', 'max:120'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'technician' => ['nullable', 'integer', 'min:1'],
            'barangay' => ['nullable', 'string', 'max:120'],
            'purpose' => ['nullable', 'string', Rule::in(app(SettingsService::class)->fieldVisitPurposes())],
        ]);

        return array_filter([
            'verification' => $validated['verification'] ?? null,
            'search' => $validated['search'] ?? null,
            'from' => $validated['from'] ?? null,
            'to' => $validated['to'] ?? null,
            'technician' => $validated['technician'] ?? null,
            'barangay' => $validated['barangay'] ?? null,
            'purpose' => $validated['purpose'] ?? null,
        ], fn ($value) => $value !== null && $value !== '');
    }

    /**
     * Log a trip (technician only).
     */
    public function store(StoreFieldVisitRequest $request): JsonResponse
    {
        $visit = $this->visits->create($request->user(), $request->validated());

        return (new FieldVisitResource($visit->load(['beneficiary', 'technician', 'dispersalEvent'])))
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
            $this->visits->update($request->user(), $visit, $request->validated())
                ->load(['beneficiary', 'technician', 'dispersalEvent']),
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
                // The office's on-site radius, so the form can state the
                // threshold it will be judged against (the verdict itself is
                // always computed server-side).
                'onsite_threshold_m' => $this->verification->thresholdM(),
            ],
        ]);
    }

    /**
     * The technician's short justification for an off-site visit ("met at
     * alternate site"). Never blocks saving the visit — the visit exists
     * either way; this only annotates the verdict. The visiting technician
     * or an admin may write it, enforced by the same policy that guards the
     * visit itself.
     */
    public function verificationNote(Request $request, int $id): FieldVisitResource
    {
        $visit = $this->visits->findScoped($request->user(), $id);

        abort_unless($visit, Response::HTTP_NOT_FOUND);

        $this->authorize('update', $visit);

        $validated = $request->validate([
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $note = trim((string) ($validated['note'] ?? ''));

        $visit->forceFill([
            'verification_note' => $note === '' ? null : $note,
            'verification_note_at' => $note === '' ? null : now(),
        ])->save();

        $this->audit->log($request->user(), 'field_visit_verification_note', $visit, [
            'has_note' => $note !== '',
        ]);

        return new FieldVisitResource($visit->load(['beneficiary', 'technician', 'photos']));
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

        // The photo's capture fix is the fix the verdict cares about —
        // re-derive the on-site status from stored coordinates now that the
        // newest photo exists.
        $this->verification->refresh($visit);

        // Evidence was just submitted — tell the supervisors who review this
        // household: admins for oversight, technicians because the photo
        // carries the animal's condition they triage on (the technician role
        // absorbed the old doctor role's health oversight). The submitting
        // technician's own visit needs no self-alert.
        $supervisors = User::query()
            ->whereIn('role', ['admin', 'technician'])
            ->where('id', '!=', $request->user()->id)
            ->get();

        foreach ($supervisors as $admin) {
            $this->notifications->create($admin, [
                'type' => UserNotification::TYPE_FIELD_VISIT_PHOTO,
                'actor_id' => $request->user()->id,
                'beneficiary_id' => $visit->beneficiary_id,
                'title' => 'Field visit photo submitted',
                'message' => "{$request->user()->name} submitted a geotagged photo for {$visit->beneficiary->name_of_farmer} in {$visit->beneficiary->address}.",
                // Role-shaped link: every staff role has its own monitoring
                // dashboard now that technicians are photo reviewers too.
                'link' => "/dashboard/{$admin->role}/monitoring",
            ]);
        }

        return (new FieldVisitPhotoResource($photo))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * A 160px JPEG for table thumbnails, generated once and cached on the
     * private disk. Authorization matches the visit itself, and the image is
     * still served from behind the session — never the public webroot.
     */
    public function photoThumbnail(Request $request, int $id): Response
    {
        $visit = $this->visits->findScoped($request->user(), $id);

        abort_unless($visit, Response::HTTP_NOT_FOUND);

        $photo = $visit->photos()->latest('id')->first();

        abort_unless($photo, Response::HTTP_NOT_FOUND);

        $disk = Storage::disk('secure');
        $source = $photo->image_path;
        $thumbPath = preg_replace('/(\.[^.\/]+)$/', '-thumb.jpg', $source);

        abort_unless($disk->exists($source), Response::HTTP_NOT_FOUND);

        if (! $disk->exists($thumbPath)) {
            $image = @imagecreatefromstring($disk->get($source));

            abort_unless($image !== false, Response::HTTP_NOT_FOUND);

            $width = imagesx($image);
            $height = imagesy($image);
            $thumbWidth = min(160, $width);
            $thumbHeight = max(1, (int) round($height * ($thumbWidth / max(1, $width))));
            $thumb = imagecreatetruecolor($thumbWidth, $thumbHeight);

            imagecopyresampled($thumb, $image, 0, 0, 0, 0, $thumbWidth, $thumbHeight, $width, $height);

            ob_start();
            imagejpeg($thumb, null, 80);
            $bytes = ob_get_clean();

            imagedestroy($thumb);
            imagedestroy($image);

            $disk->put($thumbPath, $bytes);
        }

        return $disk->response($thumbPath, null, [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => 'private, max-age=300',
        ]);
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

            // The photo's fix is gone: re-derive from what remains (the
            // trip's own fix), so the verdict never cites a deleted photo.
            $this->verification->refresh($visit);
        }

        return response()->noContent();
    }
}
