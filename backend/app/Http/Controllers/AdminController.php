<?php

namespace App\Http\Controllers;

use App\Http\Requests\AssignRoleRequest;
use App\Http\Requests\AssignTechnicianRequest;
use App\Http\Resources\BeneficiaryResource;
use App\Http\Resources\UserResource;
use App\Models\Beneficiary;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * Admin-only account and assignment management.
 */
class AdminController extends Controller
{
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
}
