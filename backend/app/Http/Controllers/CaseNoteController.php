<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreCaseNoteRequest;
use App\Http\Requests\UpdateCaseNoteRequest;
use App\Http\Resources\CaseNoteResource;
use App\Models\CaseNote;
use App\Services\CaseNoteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

class CaseNoteController extends Controller
{
    public function __construct(private readonly CaseNoteService $notes) {}

    /**
     * Role-scoped case notes.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        return CaseNoteResource::collection(
            $this->notes->listFor($request->user()),
        );
    }

    /**
     * Write a note (veterinarian only).
     */
    public function store(StoreCaseNoteRequest $request): JsonResponse
    {
        $note = $this->notes->create($request->user(), $request->validated());

        return (new CaseNoteResource($note->load(['beneficiary', 'doctor'])))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Role-scoped single fetch.
     */
    public function show(Request $request, int $id): CaseNoteResource
    {
        $note = $this->notes->findScoped($request->user(), $id);

        abort_unless($note, Response::HTTP_NOT_FOUND);

        return new CaseNoteResource($note);
    }

    /**
     * Authoring veterinarian / admin.
     */
    public function update(UpdateCaseNoteRequest $request, int $id): CaseNoteResource
    {
        $note = CaseNote::findOrFail($id);

        $this->authorize('update', $note);

        return new CaseNoteResource(
            $this->notes->update($note, $request->validated())->load(['beneficiary', 'doctor']),
        );
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $note = CaseNote::findOrFail($id);

        $this->authorize('delete', $note);

        $this->notes->delete($note);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }
}
