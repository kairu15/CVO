<?php

namespace App\Http\Controllers;

use App\Http\Requests\AdminBeneficiariesRequest;
use App\Http\Requests\AdminExcelExportRequest;
use App\Http\Requests\AdminExcelImportRequest;
use App\Http\Requests\AdminUserLifecycleRequest;
use App\Http\Requests\AdminUserStoreRequest;
use App\Http\Requests\AdminUserUpdateRequest;
use App\Http\Requests\AdminUsersRequest;
use App\Http\Requests\AssignRoleRequest;
use App\Http\Requests\AssignTechnicianRequest;
use App\Http\Requests\BulkAssignTechnicianRequest;
use App\Http\Resources\BeneficiaryResource;
use App\Http\Resources\UserResource;
use App\Models\Beneficiary;
use App\Models\User;
use App\Services\BeneficiaryService;
use App\Services\MonitoringExcelService;
use App\Services\UserAccountService;
use App\Services\UserRoleService;
use App\Support\Like;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Admin-only account and assignment management.
 */
class AdminController extends Controller
{
    public function __construct(
        private readonly MonitoringExcelService $excel,
        private readonly UserRoleService $roles,
        private readonly UserAccountService $accounts,
        private readonly BeneficiaryService $beneficiaries,
    ) {}

    /**
     * List users, optionally filtered by role — e.g.
     * /api/v1/admin/users?role=technician for the Technicians screen.
     *
     * `status` picks which account states are included: `active` (default),
     * `deactivated`, or `all`. Deactivated accounts are soft-deleted rows, so
     * the scope is chosen with onlyTrashed/withTrashed rather than a column.
     */
    public function users(AdminUsersRequest $request): AnonymousResourceCollection
    {
        $validated = $request->validated();
        $status = $validated['status'] ?? 'active';

        $users = User::query()
            ->when($status === 'deactivated', fn ($q) => $q->onlyTrashed())
            ->when($status === 'all', fn ($q) => $q->withTrashed())
            ->when($validated['role'] ?? null, fn ($q, $role) => $q->where('role', $role))
            ->when($validated['search'] ?? null, function ($q, $search): void {
                $pattern = Like::contains($search);

                $q->where(function ($q) use ($pattern): void {
                    $q->where('name', 'like', $pattern)
                        ->orWhere('email', 'like', $pattern)
                        ->orWhere('username', 'like', $pattern);
                });
            })
            ->orderBy('name')
            ->paginate(Pagination::perPage($validated['per_page'] ?? null));

        return UserResource::collection($users);
    }

    /**
     * Create a staff account (admin/doctor/technician). Farmer accounts are
     * created by public self-registration, which also creates the beneficiary
     * record — see UserAccountService.
     */
    public function storeUser(AdminUserStoreRequest $request): JsonResponse
    {
        $user = $this->accounts->create($request->user(), $request->validated());

        return (new UserResource($user))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Edit an account's name/email, and its role when one is sent.
     */
    public function updateUser(AdminUserUpdateRequest $request, int $id): UserResource
    {
        // withTrashed, like reactivateUser: a deactivated account is a
        // soft-deleted row, and correcting it (an email that changed while the
        // person was away) must not answer 404.
        $user = User::withTrashed()->findOrFail($id);

        return new UserResource(
            $this->accounts->update($request->user(), $user, $request->validated()),
        );
    }

    /**
     * Deactivate an account (soft delete + end its sessions). Reversible via
     * reactivateUser; there is no hard-delete endpoint for accounts.
     */
    public function deactivateUser(AdminUserLifecycleRequest $request, int $id): UserResource
    {
        $user = User::findOrFail($id);

        return new UserResource($this->accounts->deactivate($request->user(), $user));
    }

    /**
     * Reactivate a deactivated account. `withTrashed` is required: the row is
     * soft-deleted, so the default scope cannot see it to restore it.
     */
    public function reactivateUser(AdminUserLifecycleRequest $request, int $id): UserResource
    {
        $user = User::withTrashed()->findOrFail($id);

        return new UserResource($this->accounts->reactivate($request->user(), $user));
    }

    /**
     * Set a user's role. Admin-only, and an administrator cannot change their
     * own role — see UserRoleService for why that guard is not optional.
     */
    public function assignRole(AssignRoleRequest $request, int $id): UserResource
    {
        $user = User::findOrFail($id);

        return new UserResource(
            $this->roles->assignRole($request->user(), $user, $request->validated('role')),
        );
    }

    /**
     * Assign/reassign (or detach with null) a technician on a beneficiary.
     */
    public function assignTechnician(AssignTechnicianRequest $request, int $id): JsonResponse
    {
        $beneficiary = Beneficiary::findOrFail($id);

        // Delegates to the service so the change is appended to the
        // technician_assignments audit trail (who assigned whom, when,
        // and what it replaced).
        $beneficiary = $this->beneficiaries->assignTechnician(
            $beneficiary,
            $request->validated('technician_id'),
            $request->user(),
        );

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

        $existing = Beneficiary::query()->whereIn('id', $validated['ids'])->get();

        // One audit row per actually-updated beneficiary, so the history
        // reflects each assignment individually.
        $updated = 0;
        foreach ($existing as $beneficiary) {
            $this->beneficiaries->assignTechnician(
                $beneficiary,
                $validated['technician_id'] ?? null,
                $request->user(),
            );
            $updated++;
        }

        $existingIds = $existing->pluck('id');

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
     * current technician, paginated. `per_page` is honoured (capped at 500 by
     * the request) so the directory can show the whole set the monitoring
     * table reports on rather than a fixed 15-row slice.
     */
    public function beneficiaries(AdminBeneficiariesRequest $request): AnonymousResourceCollection
    {
        $validated = $request->validated();

        $beneficiaries = Beneficiary::query()
            ->with(['technician', 'farmer'])
            ->withCount('monitoringRecords')
            ->when($validated['search'] ?? null, function ($q, $search): void {
                $pattern = Like::contains($search);

                $q->where(function ($q) use ($pattern): void {
                    $q->where('name_of_farmer', 'like', $pattern)
                        ->orWhere('address', 'like', $pattern);
                });
            })
            ->orderBy('address')
            ->orderBy('name_of_farmer')
            ->paginate(Pagination::perPage($validated['per_page'] ?? null));

        return BeneficiaryResource::collection($beneficiaries);
    }

    /**
     * Import an uploaded "Livestock Monthly Monitoring Report" workbook —
     * either the consolidated monthly file or the per-barangay individual one.
     * Every sheet is parsed; rows become beneficiaries + monitoring records.
     */
    public function importMonitoringExcel(AdminExcelImportRequest $request): JsonResponse
    {
        $summary = $this->excel->import($request->file('file'), $request->user());

        return response()->json(['data' => $summary]);
    }

    /**
     * Export monitoring records as the standard monthly report workbook —
     * one sheet per month, mirroring the CVO Excel template.
     */
    public function exportMonitoringExcel(AdminExcelExportRequest $request): StreamedResponse
    {
        return $this->excel->downloadResponse(
            $request->validated('month') ?? null,
            $request->validated('animal_type') ?? null,
        );
    }
}
