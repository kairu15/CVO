<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreFieldVisitRequest;
use App\Http\Requests\UpdateFieldVisitRequest;
use App\Http\Resources\FieldVisitPhotoResource;
use App\Http\Resources\FieldVisitResource;
use App\Models\FieldVisit;
use App\Models\FieldVisitPhoto;
use App\Models\User;
use App\Models\UserNotification;
use App\Services\NotificationService;
use App\Services\FieldVisitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

class FieldVisitController extends Controller
{
    public function __construct(
        private readonly FieldVisitService $visits,
        private readonly NotificationService $notifications,
    ) {}

    /**
     * Role-scoped field visits.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        return FieldVisitResource::collection(
            $this->visits->listFor($request->user()),
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
            $this->visits->update($visit, $request->validated())->load(['beneficiary', 'technician']),
        );
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $visit = FieldVisit::findOrFail($id);

        $this->authorize('delete', $visit);

        $this->visits->delete($visit);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * The purpose vocabulary the field form offers, served from config/cvo.php
     * so the dropdown and the server-side validation cannot drift.
     */
    public function options(): JsonResponse
    {
        return response()->json([
            'data' => [
                'purposes' => config('cvo.field_visit_purposes'),
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
    public function storePhoto(Request $request, int $id): JsonResponse
    {
        $visit = FieldVisit::findOrFail($id);

        $this->authorize('update', $visit);

        $validated = $request->validate([
            'image' => ['required', 'image', 'mimes:jpeg,jpg', 'max:8192'], // 8 MB hard cap
            'capture_date' => ['required', 'date'],
            'capture_time' => ['required', 'date_format:H:i:s'],
            'timezone_offset' => ['required', 'string', 'max:10'],
            'capture_year' => ['required', 'integer', 'digits:4'],
            'capture_month' => ['required', 'integer', 'between:1,12'],
            'capture_day' => ['required', 'integer', 'between:1,31'],
            'capture_hour' => ['required', 'integer', 'between:0,23'],
            'capture_minute' => ['required', 'integer', 'between:0,59'],
            'capture_second' => ['required', 'integer', 'between:0,59'],
            'capture_millisecond' => ['nullable', 'integer', 'between:0,999'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'accuracy_m' => ['nullable', 'numeric', 'min:0', 'max:100000'],
            'altitude_m' => ['nullable', 'numeric', 'min:-1000', 'max:10000'],
            'speed_kmh' => ['nullable', 'numeric', 'min:0', 'max:500'],
            'heading_deg' => ['nullable', 'integer', 'between:0,359'],
            'location_source' => ['nullable', Rule::in(['gps', 'network', 'wifi', 'none'])],
            'address' => ['nullable', 'string', 'max:500'],
        ]);

        $path = $request->file('image')->store("field-visits/{$visit->id}", 'public');

        // A retake replaces: the old row goes and its file with it.
        $previous = $visit->photos()->latest('id')->first();
        if ($previous) {
            Storage::disk('public')->delete($previous->image_path);
            $previous->delete();
        }

        $photo = $visit->photos()->create([
            'technician_id' => $request->user()->id,
            'image_path' => $path,
            ...$validated,
        ]);

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
            Storage::disk('public')->delete($photo->image_path);
            $photo->delete();
        }

        return response()->noContent();
    }
}
