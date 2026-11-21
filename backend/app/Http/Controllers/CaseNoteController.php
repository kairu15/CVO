<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\BulkDeletes;
use App\Http\Requests\BulkDeleteRequest;
use App\Http\Requests\CaseNoteIndexRequest;
use App\Http\Requests\StoreCaseNotePhotoRequest;
use App\Http\Requests\StoreCaseNoteRequest;
use App\Http\Requests\StoreCaseNoteUpdateRequest;
use App\Http\Requests\UpdateCaseNoteRequest;
use App\Http\Resources\CaseNoteResource;
use App\Http\Resources\CaseNoteUpdateResource;
use App\Models\CaseNote;
use App\Services\CaseNoteService;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

class CaseNoteController extends Controller
{
    use BulkDeletes;

    public function __construct(private readonly CaseNoteService $notes) {}

    /**
     * Role-scoped case records with server-side search, filters and sorting.
     */
    public function index(CaseNoteIndexRequest $request): AnonymousResourceCollection
    {
        return CaseNoteResource::collection(
            $this->notes->listFor(
                $request->user(),
                $request->validated(),
                Pagination::perPage($request->input('per_page')),
            ),
        );
    }

    /** The four status figures and follow-up counters. */
    public function summary(Request $request): JsonResponse
    {
        abort_unless($request->user()->can('viewAny', CaseNote::class), 403);

        return response()->json([
            'data' => $this->notes->summaryFor($request->user()),
        ]);
    }

    /** Category/status vocabulary shared by the forms. */
    public function options(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->notes->optionsFor($request->user()),
        ]);
    }

    /**
     * Open a case (technician only).
     */
    public function store(StoreCaseNoteRequest $request): JsonResponse
    {
        $note = $this->notes->create($request->user(), $request->validated());

        return (new CaseNoteResource($note->load(['beneficiary', 'doctor'])))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Role-scoped case detail with timeline, links and household history.
     */
    public function show(Request $request, int $id): CaseNoteResource
    {
        $note = $this->notes->findScoped($request->user(), $id, true);

        abort_unless($note, Response::HTTP_NOT_FOUND);

        return new CaseNoteResource($note);
    }

    /**
     * Authoring technician / administrator.
     */
    public function update(UpdateCaseNoteRequest $request, int $id): CaseNoteResource
    {
        $note = CaseNote::findOrFail($id);

        $this->authorize('update', $note);

        return new CaseNoteResource(
            $this->notes->update($request->user(), $note, $request->validated())
                ->load(['beneficiary', 'doctor']),
        );
    }

    /**
     * Append a follow-up/progress entry. Any technician who can view the case
     * may add an observation; the entry records them as its author.
     */
    public function storeUpdate(StoreCaseNoteUpdateRequest $request, int $id): JsonResponse
    {
        $note = CaseNote::findOrFail($id);

        $update = $this->notes->addUpdate($request->user(), $note, $request->validated());

        return (new CaseNoteUpdateResource($update))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /** Author/admin supporting photo. */
    public function storePhoto(StoreCaseNotePhotoRequest $request, int $id): CaseNoteResource
    {
        $note = CaseNote::findOrFail($id);

        $this->authorize('update', $note);

        return new CaseNoteResource(
            $this->notes->attachPhoto($request->user(), $note, $request->file('image'))
                ->load(['beneficiary', 'doctor']),
        );
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $note = CaseNote::findOrFail($id);

        $this->authorize('delete', $note);

        $this->notes->delete($request->user(), $note);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Delete many cases in one request (the table's bulk action). Rows the
     * caller may not delete come back as failed_ids.
     */
    public function bulkDestroy(BulkDeleteRequest $request): JsonResponse
    {
        return $this->bulkDelete(
            $request,
            CaseNote::class,
            fn (CaseNote $note) => $this->notes->delete($request->user(), $note),
        );
    }
}
