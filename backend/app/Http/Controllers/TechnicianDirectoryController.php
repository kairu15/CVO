<?php

namespace App\Http\Controllers;

use App\Http\Requests\AdminTechniciansRequest;
use App\Services\TechnicianDirectoryService;
use Illuminate\Http\JsonResponse;

class TechnicianDirectoryController extends Controller
{
    public function __construct(
        private readonly TechnicianDirectoryService $directory,
    ) {}

    /**
     * One page of technicians plus the page-independent strip, filter
     * vocabulary and unassigned-household entry point — one request for the
     * whole screen.
     */
    public function index(AdminTechniciansRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $page = $this->directory->list(array_filter([
            'search' => $validated['search'] ?? null,
            'status' => $validated['status'] ?? 'active',
            'barangay' => $validated['barangay'] ?? null,
            'workload' => $validated['workload'] ?? null,
            'per_page' => $validated['per_page'] ?? null,
        ], fn ($value) => $value !== null && $value !== ''));

        return response()->json([
            'data' => $page->items(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
            'summary' => $this->directory->summary(),
            'barangays' => $this->directory->barangayOptions(),
            'unassigned' => $this->directory->unassigned(),
        ]);
    }

    /** The profile drawer: one technician, loaded on demand. */
    public function show(int $id): JsonResponse
    {
        $technician = $this->directory->detail($id);

        abort_unless($technician, 404);

        return response()->json(['data' => $technician]);
    }
}
