<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\DispersalEvent;
use App\Models\FieldVisit;
use App\Models\FieldVisitPhoto;
use App\Models\HealthRecord;
use App\Models\MonitoringRecord;
use App\Models\TechnicianAssignment;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\Barangays;
use App\Support\Pagination;
use Database\Factories\BeneficiaryFactory;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class BeneficiaryService
{
    public function __construct(
        private readonly GeocodingService $geocoder,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Role-scoped beneficiary list.
     *
     * admin/doctor: everything. technician: only assigned beneficiaries.
     * The scoping is applied at the query level so
     * the API can never leak rows the client merely failed to filter.
     *
     * `$perPage` is caller-controlled and clamped to
     * App\Support\Pagination::MAX_PER_PAGE (50), so no single response can
     * carry more than 50 households; callers that need the whole set walk the
     * pages. The default is the same 50.
     */
    public function listFor(
        User $user,
        int $perPage = Pagination::DEFAULT_PER_PAGE,
        array $filters = [],
    ): LengthAwarePaginator {
        $search = trim((string) ($filters['search'] ?? ''));
        $barangay = trim((string) ($filters['barangay'] ?? ''));

        return $this->scopeQueryFor($user)
            ->with('technician')
            ->withCount('monitoringRecords')
            // Search runs INSIDE the role scope above, so a technician can
            // never widen their view by typing a name they are not assigned.
            ->when($search !== '', fn (Builder $query) => $query->where(
                fn (Builder $group) => $group
                    ->whereLike('name_of_farmer', "%{$search}%")
                    ->orWhereLike('rsbsa_number', "%{$search}%")
                    ->orWhereLike('address', "%{$search}%")
                    ->orWhereLike('animal_type', "%{$search}%"),
            ))
            // Canonical barangay spelling, so "dawis" and "Dawis" agree.
            ->when($barangay !== '', fn (Builder $query) => $query
                ->where('address', Barangays::normalize($barangay)))
            ->latest()
            ->paginate($perPage);
    }

    /**
     * The same role scoping as a reusable query — MonitoringRecordService
     * applies it through the beneficiary relationship.
     *
     * A technician's visibility is their ACTIVE assignments (the
     * beneficiaries.technician_id column, one active technician per
     * beneficiary). History lives in the technician_assignments audit
     * table and never grants access.
     */
    public function scopeQueryFor(User $user): Builder
    {
        $query = Beneficiary::query();

        return match ($user->role) {
            'admin', 'doctor' => $query,
            'technician' => $query->where('technician_id', $user->id),
            // No other role exists. An unknown role sees nothing rather than
            // falling through to "everything" — fail closed.
            default => $query->whereRaw('0 = 1'),
        };
    }

    /**
     * Fetch ONE beneficiary with role-appropriate failure modes.
     *
     * admin/doctor: a record outside their scope is simply not found
     * for them — 404, exactly as before. A TECHNICIAN pointing at a
     * beneficiary they are not assigned to is a permissions boundary, not a
     * missing row, so it answers 403 — a silent 404 there would read as a
     * bug rather than an access rule.
     *
     * @throws \Illuminate\Database\Eloquent\ModelNotFoundException
     * @throws AuthorizationException
     */
    public function findFor(User $user, int $beneficiaryId): Beneficiary
    {
        $beneficiary = $this->scopeQueryFor($user)->find($beneficiaryId);

        if ($beneficiary) {
            return $beneficiary;
        }

        if ($user->role === 'technician'
            && Beneficiary::query()->whereKey($beneficiaryId)->exists()) {
            throw new AuthorizationException('This farmer is not assigned to you.');
        }

        // Genuinely missing (or out of scope for a non-technician role).
        abort(404);
    }

    /**
     * Assign (or clear) the active technician on a beneficiary and append
     * the change to the audit trail.
     *
     * The active assignment is the single source of truth for scoping (the
     * beneficiaries.technician_id column); history rows in
     * technician_assignments exist for accountability only and never grant
     * access.
     */
    public function assignTechnician(Beneficiary $beneficiary, ?int $technicianId, User $actor): Beneficiary
    {
        $previous = $beneficiary->technician_id;

        $beneficiary->update(['technician_id' => $technicianId]);

        TechnicianAssignment::create([
            'beneficiary_id' => $beneficiary->id,
            'technician_id' => $technicianId,
            'assigned_by' => $actor->id,
            'assigned_at' => now(),
            'previous_technician_id' => $previous,
        ]);

        $this->audit->log($actor, 'technician_assigned', $beneficiary, [
            'technician_id' => $technicianId,
            'previous_technician_id' => $previous,
        ]);

        // Notify the technician gaining (or losing) the household, and the
        // farmer whose animal it is. A reassignment is one event with two
        // sides: the new technician needs to know they are on, the old one
        // that they are off.
        //
        // Resolved lazily: NotificationService depends on the vaccination /
        // dispersal services, which depend on THIS service — a constructor
        // injection here would be a resolution cycle. At call time the
        // graph is already built, so the container hands it over fine.
        $notifications = app(NotificationService::class);

        $isReassignment = $previous !== null && $technicianId !== null && $previous !== $technicianId;
        $type = $isReassignment
            ? UserNotification::TYPE_TECHNICIAN_REASSIGNED
            : UserNotification::TYPE_TECHNICIAN_ASSIGNED;
        $household = "{$beneficiary->name_of_farmer} in {$beneficiary->address}";

        if ($technicianId !== null) {
            $technician = User::find($technicianId);

            if ($technician) {
                $notifications->create($technician, [
                    'type' => $type,
                    'actor_id' => $actor->id,
                    'beneficiary_id' => $beneficiary->id,
                    'title' => $isReassignment ? 'Farmer reassigned to you' : 'Farmer assigned to you',
                    'message' => "{$actor->name} assigned {$household} to you.",
                    'link' => '/dashboard/technician/monitoring',
                ]);
            }
        }

        // The outgoing technician only hears about it on a reassignment.
        if ($isReassignment) {
            $outgoing = User::find($previous);

            if ($outgoing) {
                $notifications->create($outgoing, [
                    'type' => $type,
                    'actor_id' => $actor->id,
                    'beneficiary_id' => $beneficiary->id,
                    'title' => 'Farmer reassigned away from you',
                    'message' => "{$actor->name} reassigned {$household} to another technician.",
                    'link' => '/dashboard/technician/monitoring',
                ]);
            }
        }

        return $beneficiary->refresh();
    }

    /**
     * Create a beneficiary record directly — the admin-managed enrolment
     * path that replaced public self-registration.
     *
     * No account, no password, no pending state: the staff member entering it
     * is asserting this is a real enrolled beneficiary.
     *
     * An initial monitoring record is created in the same transaction, so the
     * household lands on the Monitoring table immediately (exactly what
     * registration used to trigger). A technician who enrols a household owns
     * that record; otherwise it is unassigned until the admin assigns one.
     */
    public function create(User $actor, array $data): Beneficiary
    {
        return DB::transaction(function () use ($actor, $data): Beneficiary {
            // No pin captured in the field? Resolve the address to real
            // coordinates so the dispersal map shows it in the right place.
            if (! isset($data['latitude'], $data['longitude'])) {
                $geo = $this->geocodeFor($data['address'] ?? null);

                $data['latitude'] = $geo['lat'] ?? null;
                $data['longitude'] = $geo['lng'] ?? null;
            }

            $beneficiary = Beneficiary::create($data);

            $record = $beneficiary->monitoringRecords()->create([
                'technician_id' => $actor->role === 'technician' ? $actor->id : null,
            ]);

            $this->audit->log($actor, 'beneficiary_created', $beneficiary);

            // Tell the OTHER administrators a beneficiary was added — the
            // trigger that replaced "a new farmer registered". Resolved lazily
            // through the container: NotificationService depends on services
            // that depend on THIS one, so a constructor injection would be a
            // resolution cycle (same reason assignTechnician resolves it late).
            $notifications = app(NotificationService::class);

            User::query()
                ->where('role', 'admin')
                ->where('id', '!=', $actor->id)
                ->get()
                ->each(fn (User $admin) => $notifications->create($admin, [
                    'type' => UserNotification::TYPE_BENEFICIARY_ADDED,
                    'actor_id' => $actor->id,
                    'beneficiary_id' => $beneficiary->id,
                    'monitoring_record_id' => $record->id,
                    'title' => 'Beneficiary added',
                    'message' => "{$beneficiary->name_of_farmer} in {$beneficiary->address} was added to the program.",
                    'link' => '/dashboard/admin/beneficiaries',
                ]));

            return $beneficiary->refresh();
        });
    }

    /**
     * Resolve a beneficiary address to coordinates (city-scoped), or null.
     *
     * @return array{lat: float, lng: float, display_name: string}|null
     */
    public function geocodeFor(?string $address): ?array
    {
        if (! $address) {
            return null;
        }

        $hit = $this->geocoder->geocode($address, 'Bayawan, Philippines');

        if ($hit) {
            return ['lat' => $hit['lat'], 'lng' => $hit['lng'], 'display_name' => $hit['display_name']];
        }

        // OSM doesn't index every local barangay name — fall back to the
        // authoritative barangay center so the pin still lands in the right
        // barangay instead of nowhere (or in the wrong province).
        $centroid = BeneficiaryFactory::BARANGAY_COORDS()[$address] ?? null;

        if ($centroid) {
            return [
                'lat' => $centroid[0],
                'lng' => $centroid[1],
                'display_name' => "{$address}, Bayawan City, Negros Oriental (barangay centroid)",
            ];
        }

        return null;
    }

    /**
     * Remove a beneficiary record completely — the household and its whole
     * clinical/visit/assignment/dispersal history — inside one transaction.
     *
     * Everything is SOFT-deleted (the tables carry `deleted_at`), so the rows
     * vanish from every normal list, report and alert while remaining in the
     * database for LGU audit/retention. Eloquent's SoftDeletes global scope
     * hides them automatically; the raw correlated subqueries in the report /
     * schedule / smart-alert services carry an explicit `deleted_at is null`
     * filter for the same reason.
     *
     * There is no account to remove — a beneficiary is a record, not a login.
     *
     * Notifications are the one exception: `user_notifications.dedupe_key` is
     * UNIQUE and the daily Smart Alerts scan re-creates rows by that key, so
     * they cannot be soft-deleted without a re-insert collision. They are
     * transient events and are deleted outright.
     */
    public function deleteBeneficiary(User $actor, Beneficiary $beneficiary): void
    {
        DB::transaction(function () use ($actor, $beneficiary): void {
            $beneficiaryId = $beneficiary->id;

            // Collect the ids first: once the rows are soft-deleted the
            // default scope can no longer see them.
            $recordIds = MonitoringRecord::query()
                ->where('beneficiary_id', $beneficiaryId)
                ->pluck('id');

            $visitIds = FieldVisit::query()
                ->where('beneficiary_id', $beneficiaryId)
                ->pluck('id');

            // Photos hang off a VISIT, not off the beneficiary.
            if ($visitIds->isNotEmpty()) {
                FieldVisitPhoto::query()->whereIn('field_visit_id', $visitIds)->delete();
            }

            FieldVisit::query()->where('beneficiary_id', $beneficiaryId)->delete();
            HealthRecord::query()->where('beneficiary_id', $beneficiaryId)->delete();
            CaseNote::query()->where('beneficiary_id', $beneficiaryId)->delete();

            // A dispersal event can touch this household as the recipient, as
            // the parent whose animal produced the offspring, or as the
            // inline-registered recipient — all belong to its chain.
            DispersalEvent::query()
                ->where(function (Builder $q) use ($beneficiaryId): void {
                    $q->where('beneficiary_id', $beneficiaryId)
                        ->orWhere('parent_beneficiary_id', $beneficiaryId)
                        ->orWhere('new_beneficiary_id', $beneficiaryId);
                })
                ->delete();

            // The household's whole monitoring history.
            MonitoringRecord::query()->where('beneficiary_id', $beneficiaryId)->delete();

            TechnicianAssignment::query()->where('beneficiary_id', $beneficiaryId)->delete();

            UserNotification::query()
                ->where(function (Builder $q) use ($beneficiaryId, $recordIds): void {
                    $q->where('beneficiary_id', $beneficiaryId)
                        ->orWhereIn('monitoring_record_id', $recordIds);
                })
                ->delete();

            $beneficiary->delete();

            $this->audit->log($actor, 'beneficiary_deleted', $beneficiary);
        });
    }
}
