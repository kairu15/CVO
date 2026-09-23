<?php

namespace App\Http\Controllers;

use App\Http\Requests\AssignRoleRequest;
use App\Http\Requests\AssignTechnicianRequest;
use App\Http\Requests\BulkAssignTechnicianRequest;
use App\Http\Resources\BeneficiaryResource;
use App\Http\Resources\UserResource;
use App\Models\Beneficiary;
use App\Models\User;
use App\Services\MonitoringExcelService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Admin-only account and assignment management.
 */
class AdminController extends Controller
{
    public function __construct(private readonly MonitoringExcelService $excel) {}

    /**
     * List users, optionally filtered by role — e.g.
     * /api/v1/admin/users?role=technician for the Technicians screen.
     */
    public function users(Request $request): AnonymousResourceCollection
    {
        $validated = $request->validate([
            'role' => ['sometimes', Rule::in(User::ROLES)],
            'search' => ['sometimes', 'string', 'max:255'],
        ]);

        $users = User::query()
            ->when($validated['role'] ?? null, fn ($q, $role) => $q->where('role', $role))
            ->when($validated['search'] ?? null, function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%")
                        ->orWhere('username', 'like', "%{$search}%");
                });
            })
            ->orderBy('name')
            ->paginate(15);

        return UserResource::collection($users);
    }

    /**
     * Set a user's role. Mirrors the rule that role changes are admin-only.
     */
    public function assignRole(AssignRoleRequest $request, int $id): UserResource
    {
        $user = User::findOrFail($id);
        $user->update(['role' => $request->validated('role')]);

        return new UserResource($user->refresh());
    }

    /**
     * Assign/reassign (or detach with null) a technician on a beneficiary.
     */
    public function assignTechnician(AssignTechnicianRequest $request, int $id): JsonResponse
    {
        $beneficiary = Beneficiary::findOrFail($id);

        $beneficiary->update([
            'technician_id' => $request->validated('technician_id'),
        ]);

        return response()->json([
            'data' => [
                'id' => $beneficiary->id,
                'technician_id' => $beneficiary->technician_id,
            ],
        ]);
    }

    /**
     * Assign/reassign (or detach with null) a technician on many beneficiaries
     * in one transaction. Responds with the applied count and the ids that
     * could not be applied (unknown/already-deleted rows), so the UI can
     * surface partial failures per row.
     */
    public function bulkAssignTechnician(BulkAssignTechnicianRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $updated = Beneficiary::query()
            ->whereIn('id', $validated['ids'])
            ->update(['technician_id' => $validated['technician_id'] ?? null]);

        $existingIds = Beneficiary::query()
            ->whereIn('id', $validated['ids'])
            ->pluck('id');

        $failedIds = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->reject(fn ($id) => $existingIds->contains($id))
            ->values();

        return response()->json([
            'data' => [
                'updated' => $updated,
                'failed_ids' => $failedIds,
            ],
        ]);
    }

    /**
     * Beneficiaries grouped for bulk assignment: every beneficiary with its
     * current technician, paginated.
     */
    public function beneficiaries(Request $request): AnonymousResourceCollection
    {
        $beneficiaries = Beneficiary::query()
            ->with(['technician', 'farmer'])
            ->withCount('monitoringRecords')
            ->when($request->string('search')->toString(), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('name_of_farmer', 'like', "%{$search}%")
                        ->orWhere('address', 'like', "%{$search}%");
                });
            })
            ->orderBy('address')
            ->orderBy('name_of_farmer')
            ->paginate(15);

        return BeneficiaryResource::collection($beneficiaries);
    }

    /**
     * Import an uploaded "Livestock Monthly Monitoring Report" workbook —
     * either the consolidated monthly file or the per-barangay individual one.
     * Every sheet is parsed; rows become beneficiaries + monitoring records.
     */
    public function importMonitoringExcel(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:20480'],
        ]);

        $summary = $this->excel->import($validated['file'], $request->user());

        return response()->json(['data' => $summary]);
    }

    /**
     * Export monitoring records as the standard monthly report workbook —
     * one sheet per month, mirroring the CVO Excel template.
     */
    public function exportMonitoringExcel(Request $request): StreamedResponse
    {
        $validated = $request->validate([
            'month' => ['nullable', 'date_format:Y-m'],
        ]);

        return $this->excel->downloadResponse($validated['month'] ?? null);
    }
}
