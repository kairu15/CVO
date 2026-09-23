<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreFieldVisitRequest;
use App\Http\Requests\UpdateFieldVisitRequest;
use App\Http\Resources\FieldVisitResource;
use App\Models\FieldVisit;
use App\Services\FieldVisitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

class FieldVisitController extends Controller
{
    public function __construct(private readonly FieldVisitService $visits) {}

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
}
