<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class FieldVisitService
{
    /**
     * Role-scoped visits, newest first.
     *
     * Note the technician scope differs from every other service in this
     * codebase: it filters on the VISITING technician rather than on assigned
     * beneficiaries, because a visit is the technician's own activity log.
     */
    public function listFor(User $user): LengthAwarePaginator
    {
        return $this->scopeFor($user)
            ->with(['beneficiary', 'technician', 'photos'])
            ->latest('visited_on')
            ->latest('id')
            ->paginate(15);
    }

    /**
     * Role-scoped single fetch — never 404s a visit that merely sits past page
     * one of the index.
     */
    public function findScoped(User $user, int $id): ?FieldVisit
    {
        return $this->scopeFor($user)
            ->with(['beneficiary', 'technician', 'photos'])
            ->find($id);
    }

    /**
     * The role-scoped base query: rows visible to this user only.
     */
    protected function scopeFor(User $user): Builder
    {
        $query = FieldVisit::query();

        return match ($user->role) {
            'admin', 'doctor' => $query,
            'technician' => $query->where('technician_id', $user->id),
            default => $query->whereIn(
                'beneficiary_id',
                Beneficiary::query()->where('farmer_id', $user->id)->select('id'),
            ),
        };
    }

    /**
     * Log a trip. The technician is recorded as its author; eligibility is
     * enforced by StoreFieldVisitRequest.
     */
    public function create(User $technician, array $data): FieldVisit
    {
        return FieldVisit::create([
            ...$data,
            'technician_id' => $technician->id,
        ]);
    }

    public function update(FieldVisit $visit, array $data): FieldVisit
    {
        $visit->update($data);

        return $visit->refresh();
    }

    public function delete(FieldVisit $visit): void
    {
        $visit->delete();
    }

    /**
     * Metres between a visit's captured fix and the beneficiary's registered
     * location, or null when either end is missing.
     *
     * Included because a captured coordinate is inert on its own: the useful
     * question in the field is "did I actually stand where the pin says?"
     */
    public static function distanceMeters(
        ?float $lat1,
        ?float $lng1,
        ?float $lat2,
        ?float $lng2,
    ): ?int {
        if ($lat1 === null || $lng1 === null || $lat2 === null || $lng2 === null) {
            return null;
        }

        $earthRadius = 6371000.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return (int) round($earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a)));
    }
}
