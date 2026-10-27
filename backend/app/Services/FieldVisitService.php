<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\User;
use App\Support\Pagination;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class FieldVisitService
{
    public function __construct(
        private readonly AuditLogger $audit,
        private readonly FieldVisitVerificationService $verification,
    ) {}
    /**
     * Role-scoped visits, newest first.
     *
     * Note the technician scope differs from every other service in this
     * codebase: it filters on the VISITING technician rather than on assigned
     * beneficiaries, because a visit is the technician's own activity log.
     *
     * `$verificationFilter` narrows to one on-site verdict (or the `review`
     * bucket = off_site + low_accuracy + no_reference_location) so the
     * "Off-site / needs review" filter happens in the database, before
     * pagination — the same rule as every other list filter here.
     */
    public function listFor(
        User $user,
        int $perPage = Pagination::DEFAULT_PER_PAGE,
        ?string $verificationFilter = null,
    ): LengthAwarePaginator {
        return $this->scopeFor($user)
            ->when(
                $verificationFilter !== null && $verificationFilter !== 'all',
                fn (Builder $query) => $this->applyVerificationFilter($query, $verificationFilter),
            )
            ->with(['beneficiary', 'technician', 'photos'])
            ->latest('visited_on')
            ->latest('id')
            ->paginate($perPage);
    }

    /**
     * Narrow a visit query to one verification status (or the review bucket).
     * Public so the report summary and the work queue reuse the same bucket
     * definition instead of restating it.
     */
    public function applyVerificationFilter(Builder $query, string $filter): Builder
    {
        if ($filter === 'review') {
            return $query->whereIn('verification_status', FieldVisitVerificationService::REVIEW_STATUSES);
        }

        if (in_array($filter, FieldVisitVerificationService::STATUSES, true)) {
            return $query->where('verification_status', $filter);
        }

        // Unknown bucket: no narrowing rather than an accidental full match.
        // The controller validates the value before it gets here.
        return $query;
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
            // No other role exists; fail closed.
            default => $query->whereRaw('0 = 1'),
        };
    }

    /**
     * Log a trip. The technician is recorded as its author; eligibility is
     * enforced by StoreFieldVisitRequest.
     */
    public function create(User $technician, array $data): FieldVisit
    {
        $visit = FieldVisit::create([
            ...$data,
            'technician_id' => $technician->id,
        ]);

        $this->audit->log($technician, 'field_visit_created', $visit);

        // Server-side verdict over stored coordinates — including on a
        // replayed offline submission, which arrives through this same path.
        $this->verification->refresh($visit);

        return $visit->refresh();
    }

    public function update(User $actor, FieldVisit $visit, array $data): FieldVisit
    {
        $visit->update($data);

        $this->audit->log($actor, 'field_visit_updated', $visit);

        // The fix may have moved (or arrived for the first time): re-derive
        // the verdict from the stored coordinates, never from the client.
        $this->verification->refresh($visit);

        return $visit->refresh();
    }

    public function delete(User $actor, FieldVisit $visit): void
    {
        $visit->delete();

        $this->audit->log($actor, 'field_visit_deleted', $visit);
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
