<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\User;
use App\Support\Barangays;
use App\Support\Like;
use App\Support\Pagination;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\LazyCollection;

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
     *
     * `$filters` is the admin log's search and narrowing set (search, from,
     * to, technician, barangay, purpose), also applied before pagination.
     */
    public function listFor(
        User $user,
        int $perPage = Pagination::DEFAULT_PER_PAGE,
        ?string $verificationFilter = null,
        array $filters = [],
    ): LengthAwarePaginator {
        return $this->queryFor($user, $verificationFilter, $filters)
            ->with($this->relations())
            ->latest('visited_on')
            ->latest('id')
            ->paginate($perPage);
    }

    /**
     * The filtered query without pagination — shared by the list, the CSV
     * export and any count so all three can never disagree.
     *
     * @param  array<string, mixed>  $filters
     */
    public function queryFor(
        User $user,
        ?string $verificationFilter = null,
        array $filters = [],
    ): Builder {
        $query = $this->scopeFor($user);

        if ($verificationFilter !== null && $verificationFilter !== 'all') {
            $this->applyVerificationFilter($query, $verificationFilter);
        }

        $this->applyFilters($query, $filters);

        return $query;
    }

    /**
     * Apply the log's narrowing filters in one place.
     *
     * @param  array<string, mixed>  $filters
     */
    public function applyFilters(Builder $query, array $filters): void
    {
        $search = trim((string) ($filters['search'] ?? ''));
        $from = $filters['from'] ?? null;
        $to = $filters['to'] ?? null;
        $technician = $filters['technician'] ?? null;
        $barangay = trim((string) ($filters['barangay'] ?? ''));
        $purpose = trim((string) ($filters['purpose'] ?? ''));

        // Search spans the identifiers an administrator actually types:
        // farmer, RSBSA #, ear tag #, and the technician who went.
        $query->when($search !== '', function (Builder $q) use ($search): void {
            $pattern = Like::contains($search);

            $q->where(function (Builder $group) use ($pattern): void {
                $group->whereHas('beneficiary', function (Builder $b) use ($pattern): void {
                    $b->where(function (Builder $identity) use ($pattern): void {
                        $identity->whereRaw('LOWER(name_of_farmer) LIKE ?', [$pattern])
                            ->orWhereRaw("LOWER(COALESCE(rsbsa_number, '')) LIKE ?", [$pattern])
                            ->orWhereRaw("LOWER(COALESCE(ear_tag_number, '')) LIKE ?", [$pattern]);
                    });
                })->orWhereHas(
                    'technician',
                    fn (Builder $t) => $t->whereRaw('LOWER(name) LIKE ?', [$pattern]),
                );
            });
        });

        $query->when($from !== null && $from !== '', fn (Builder $q) => $q->whereDate('visited_on', '>=', $from));
        $query->when($to !== null && $to !== '', fn (Builder $q) => $q->whereDate('visited_on', '<=', $to));

        $query->when(
            $technician !== null && $technician !== '' && ctype_digit((string) $technician),
            fn (Builder $q) => $q->where('technician_id', (int) $technician),
        );

        // Canonical barangay spelling first, raw address as the historical
        // fallback — the same rule the beneficiary directory uses.
        $query->when($barangay !== '', fn (Builder $q) => $q->whereHas(
            'beneficiary',
            fn (Builder $b) => $b->where(
                fn (Builder $w) => $w->where('address', Barangays::normalize($barangay))
                    ->orWhere('address', $barangay),
            ),
        ));

        $query->when($purpose !== '', fn (Builder $q) => $q->where('purpose', $purpose));
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
     * Eager loads for one page of the log: household identity, the visit's
     * technician and photo, the linked dispersal, and the household's latest
     * monitoring date. Constant query count regardless of page size.
     *
     * @return array<string, mixed>
     */
    protected function relations(): array
    {
        return [
            'technician',
            'photos',
            'dispersalEvent',
            'beneficiary' => function ($query): void {
                $query->withMax(
                    'monitoringRecords as monitoring_records_max_date_monitored',
                    'date_monitored',
                );
            },
        ];
    }

    /**
     * The stat strip: one scoped aggregate request, no rows. Counts are for
     * the viewer's own log (a technician) or the whole program (an admin).
     *
     * @return array<string, mixed>
     */
    public function summaryFor(User $user): array
    {
        $since = now()->subDays(30)->toDateString();
        $scope = fn (): Builder => $this->scopeFor($user);

        $total = $scope()->count();
        $recent = $scope()->whereDate('visited_on', '>=', $since)->count();
        $review = $scope()
            ->whereIn('verification_status', FieldVisitVerificationService::REVIEW_STATUSES)
            ->count();
        $noGps = $scope()
            ->where('verification_status', FieldVisitVerificationService::STATUS_NO_GPS)
            ->count();
        $onSite = $scope()
            ->where('verification_status', FieldVisitVerificationService::STATUS_ON_SITE)
            ->count();

        return [
            'total' => $total,
            'visits_30d' => $recent,
            'needs_review' => $review,
            'no_gps' => $noGps,
            'on_site' => $onSite,
            'on_site_rate' => $total > 0 ? (int) round(($onSite / $total) * 100) : null,
            'window_days' => 30,
        ];
    }

    /**
     * Assigned households with no dated monitoring or field visit inside the
     * shared 60-day window — the "Visits due" worklist, derived from stored
     * rows rather than a schedule table.
     *
     * `$followUp` narrows to households whose dispersal is older than the
     * window and still has no visit since: the dispersal follow-up check.
     *
     * @return array<string, mixed>
     */
    public function visitsDueFor(User $user, bool $followUp = false): array
    {
        $cutoff = now()->subDays(BeneficiaryDirectoryService::OVERDUE_DAYS)->toDateString();

        $query = Beneficiary::query()
            ->whereNotNull('technician_id')
            ->whereDoesntHave(
                'monitoringRecords',
                fn (Builder $q) => $q->whereNotNull('date_monitored')
                    ->where('date_monitored', '>=', $cutoff),
            )
            ->whereDoesntHave(
                'fieldVisits',
                fn (Builder $q) => $q->where('visited_on', '>=', $cutoff),
            );

        if ($user->role === 'technician') {
            $query->where('technician_id', $user->id);
        }

        if ($followUp) {
            $query->whereHas(
                'dispersalEvents',
                fn (Builder $q) => $q->where('date_dispersed', '<=', $cutoff),
            );
        }

        $total = (clone $query)->count();

        $households = $query
            ->with('technician')
            ->withMax('fieldVisits as last_visit_on', 'visited_on')
            ->withMax('monitoringRecords as last_monitoring_on', 'date_monitored')
            ->orderBy('address')
            ->orderBy('name_of_farmer')
            ->limit(10)
            ->get()
            ->map(fn (Beneficiary $b) => [
                'id' => $b->id,
                'name_of_farmer' => $b->name_of_farmer,
                'address' => $b->address,
                'technician' => $b->technician?->name,
                'last_visit_on' => $b->last_visit_on,
                'last_monitoring_on' => $b->last_monitoring_on,
            ])
            ->all();

        return [
            'total' => $total,
            'households' => $households,
            'window_days' => BeneficiaryDirectoryService::OVERDUE_DAYS,
            'coverage' => $this->coverageFor($user),
        ];
    }

    /**
     * Per-technician coverage: assigned households and how many of them were
     * visited in the last 30 days. Two grouped counts, no new writes.
     *
     * @return list<array<string, mixed>>
     */
    private function coverageFor(User $user): array
    {
        $since = now()->subDays(30)->toDateString();

        $technicians = User::query()
            ->where('role', 'technician')
            ->when($user->role === 'technician', fn (Builder $q) => $q->whereKey($user->id))
            ->orderBy('name')
            ->get(['id', 'name']);

        $assigned = Beneficiary::query()
            ->whereNotNull('technician_id')
            ->selectRaw('technician_id, count(*) as total')
            ->groupBy('technician_id')
            ->pluck('total', 'technician_id');

        $visited = FieldVisit::query()
            ->whereDate('visited_on', '>=', $since)
            ->selectRaw('technician_id, count(distinct beneficiary_id) as total')
            ->groupBy('technician_id')
            ->pluck('total', 'technician_id');

        return $technicians->map(function (User $technician) use ($assigned, $visited): array {
            $count = (int) ($assigned[$technician->id] ?? 0);
            $seen = (int) ($visited[$technician->id] ?? 0);

            return [
                'id' => $technician->id,
                'name' => $technician->name,
                'assigned' => $count,
                'visited_30d' => $seen,
                'coverage_pct' => $count > 0 ? (int) round(min(100, ($seen / $count) * 100)) : null,
            ];
        })->all();
    }

    /**
     * The filtered log as a lazy row stream for the CSV export.
     *
     * @param  array<string, mixed>  $filters
     * @return LazyCollection<int, FieldVisit>
     */
    public function rowsFor(User $user, ?string $verificationFilter, array $filters): LazyCollection
    {
        return $this->queryFor($user, $verificationFilter, $filters)
            ->with($this->relations())
            ->latest('visited_on')
            ->latest('id')
            ->lazy(200);
    }

    /**
     * Role-scoped single fetch — never 404s a visit that merely sits past page
     * one of the index.
     */
    public function findScoped(User $user, int $id): ?FieldVisit
    {
        return $this->scopeFor($user)
            ->with($this->relations())
            ->find($id);
    }

    /**
     * The role-scoped base query: rows visible to this user only.
     */
    protected function scopeFor(User $user): Builder
    {
        $query = FieldVisit::query();

        return match ($user->role) {
            'admin', 'technician' => $query,
            // No other role exists; fail closed.
            default => $query->whereRaw('0 = 1'),
        };
    }

    /**
     * Log a trip. The technician is recorded as its author; eligibility is
     * enforced by StoreFieldVisitRequest.
     *
     * When the trip is a dispersal follow-up and the household has exactly one
     * dispersal on record, that event is attached automatically — the common
     * case needs no extra choice from the technician.
     */
    public function create(User $technician, array $data): FieldVisit
    {
        if (($data['purpose'] ?? null) === 'dispersal' && empty($data['dispersal_event_id'])) {
            $events = Beneficiary::query()
                ->find($data['beneficiary_id'])?->dispersalEvents()
                ->orderByDesc('date_dispersed')
                ->orderByDesc('id')
                ->get(['id']);

            if ($events && $events->count() === 1) {
                $data['dispersal_event_id'] = $events->first()->id;
            }
        }

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
