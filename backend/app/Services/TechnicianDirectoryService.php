<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Beneficiary;
use App\Models\FieldVisit;
use App\Models\User;
use App\Support\Barangays;
use App\Support\Like;
use App\Support\Pagination;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * The admin Technicians screen: one page of technician accounts, each with the
 * workload signals the office actually has.
 *
 * There is deliberately no stored "workload" column and no separate
 * assignment table for a technician's barangays. Assigned households are
 * beneficiaries.technician_id; a technician's barangays are the distinct
 * addresses behind those households; completed visits are field_visits rows;
 * and "due" reuses the shared 60-day contact window. The directory, the
 * beneficiary directory and the field-visit log therefore cannot disagree
 * about the same household.
 */
class TechnicianDirectoryService
{
    /** A household with no monitoring or visit in this window is due. */
    public const CONTACT_DAYS = BeneficiaryDirectoryService::OVERDUE_DAYS;

    /** Workload bands over assigned households. */
    public const WORKLOAD_LIGHT_MAX = 9;

    public const WORKLOAD_MODERATE_MAX = 19;

    /**
     * The KPI strip. The total includes deactivated accounts; the assignment
     * figure counts only ACTIVE technicians, because those are the accounts
     * that can currently receive work.
     *
     * @return array{total: int, active: int, deactivated: int, with_assignments: int}
     */
    public function summary(): array
    {
        $active = User::query()->where('role', 'technician')->count();
        $deactivated = User::onlyTrashed()->where('role', 'technician')->count();

        $withAssignments = User::query()
            ->where('role', 'technician')
            ->whereIn(
                'users.id',
                Beneficiary::query()
                    ->whereNotNull('technician_id')
                    ->select('technician_id'),
            )
            ->count();

        return [
            'total' => $active + $deactivated,
            'active' => $active,
            'deactivated' => $deactivated,
            'with_assignments' => $withAssignments,
        ];
    }

    /**
     * The barangay filter's vocabulary. The covered list is the same one the
     * beneficiary directory uses, so a filter cannot offer a barangay the
     * program does not cover.
     *
     * @return list<string>
     */
    public function barangayOptions(): array
    {
        return Barangays::all();
    }

    /**
     * One filtered page of technicians.
     *
     * @param  array<string, mixed>  $filters
     */
    public function list(array $filters): LengthAwarePaginator
    {
        $query = $this->baseQuery();

        $this->applyStatus($query, (string) ($filters['status'] ?? 'active'));
        $this->applyFilters($query, $filters);

        $paginator = $query
            ->orderBy('users.name')
            ->paginate(Pagination::perPage($filters['per_page'] ?? null));

        $ids = collect($paginator->items())->pluck('id')->map(fn ($id) => (int) $id)->all();
        $barangays = $this->barangaysFor($ids);

        $paginator->setCollection(
            collect($paginator->items())
                ->map(fn (User $technician): array => $this->row(
                    $technician,
                    $barangays[(int) $technician->id] ?? [],
                ))
                ->values(),
        );

        return $paginator;
    }

    /**
     * A profile drawer payload. Loaded only when the drawer opens, so the
     * directory page does not pay for every technician's visit history.
     *
     * @return array<string, mixed>|null
     */
    public function detail(int $id): ?array
    {
        $technician = $this->baseQuery(withTrashed: true)
            ->whereKey($id)
            ->where('users.role', 'technician')
            ->first();

        if (! $technician) {
            return null;
        }

        $barangays = $this->barangayCountsFor($id);
        $row = $this->row($technician, array_keys($barangays));

        $row['barangays'] = collect($barangays)
            ->map(fn (int $households, string $name): array => [
                'name' => $name,
                'households' => $households,
            ])
            ->values()
            ->all();

        $row['assignments'] = Beneficiary::query()
            ->where('technician_id', $id)
            ->orderBy('address')
            ->orderBy('name_of_farmer')
            ->limit(24)
            ->get(['id', 'name_of_farmer', 'address', 'animal_type', 'sex'])
            ->map(fn (Beneficiary $beneficiary): array => [
                'id' => $beneficiary->id,
                'name' => $beneficiary->name_of_farmer,
                'address' => $beneficiary->address,
                'animal_type' => $beneficiary->animal_type,
                'sex' => $beneficiary->sex,
            ])
            ->all();

        $row['recent_visits'] = FieldVisit::query()
            ->where('technician_id', $id)
            ->with('beneficiary:id,name_of_farmer,address')
            ->latest('visited_on')
            ->latest('id')
            ->limit(6)
            ->get()
            ->map(fn (FieldVisit $visit): array => [
                'id' => $visit->id,
                'visited_on' => $visit->visited_on?->toDateString(),
                'purpose' => $visit->purpose,
                'beneficiary' => $visit->beneficiary?->name_of_farmer,
                'address' => $visit->beneficiary?->address,
                'verification_status' => $visit->verification_status,
            ])
            ->all();

        // Sign-ins are already visible in User Management; this drawer is the
        // field-work/admin trail, so auth-only events are left out.
        $row['recent_activity'] = ActivityLog::query()
            ->with('actor:id,name')
            ->where(function (Builder $query) use ($id): void {
                $query->where('actor_id', $id)
                    ->orWhere(function (Builder $target) use ($id): void {
                        $target->where('target_type', 'User')->where('target_id', $id);
                    });
            })
            ->whereNotIn('action', [
                'login', 'logout', 'logout_all', 'failed_login', 'token_issued',
            ])
            ->latest('created_at')
            ->latest('id')
            ->limit(8)
            ->get()
            ->map(fn (ActivityLog $log): array => [
                'id' => $log->id,
                'action' => $log->action,
                'target_type' => $log->target_type,
                'target_id' => $log->target_id,
                'actor_name' => $log->actor?->name,
                'created_at' => $log->created_at?->toIso8601String(),
            ])
            ->all();

        return $row;
    }

    /**
     * Households with no technician, shown as a compact entry point so the
     * assignment workflow that lived on this screen is not lost.
     *
     * @return array{total: int, households: list<array<string, mixed>>}
     */
    public function unassigned(): array
    {
        $query = Beneficiary::query()->whereNull('technician_id');

        return [
            'total' => (clone $query)->count(),
            'households' => $query
                ->orderBy('name_of_farmer')
                ->limit(5)
                ->get(['id', 'name_of_farmer', 'address', 'animal_type', 'sex'])
                ->map(fn (Beneficiary $beneficiary): array => [
                    'id' => $beneficiary->id,
                    'name' => $beneficiary->name_of_farmer,
                    'address' => $beneficiary->address,
                    'animal_type' => $beneficiary->animal_type,
                    'sex' => $beneficiary->sex,
                ])
                ->all(),
        ];
    }

    /**
     * The base aggregate query. Counts are correlated subqueries so the whole
     * page — including workload filters — is one database round trip and
     * pagination happens after filtering, never before.
     */
    private function baseQuery(bool $withTrashed = false): Builder
    {
        $since = now()->subDays(30)->toDateString();
        $cutoff = now()->subDays(self::CONTACT_DAYS)->toDateString();

        $query = User::query()
            ->where('users.role', 'technician')
            ->select('users.*')
            ->selectRaw($this->assignedSql().' as assigned_households')
            ->selectRaw($this->completedVisitsSql().' as visits_completed')
            ->selectRaw($this->recentVisitsSql().' as visits_30d', [$since])
            ->selectRaw($this->visitedHouseholdsSql().' as visited_households_30d', [$since])
            ->selectRaw($this->lastVisitSql().' as last_visit_on')
            ->selectRaw($this->dueHouseholdsSql().' as due_households', [$cutoff, $cutoff]);

        return $withTrashed ? $query->withTrashed() : $query;
    }

    /** @param array<string, mixed> $filters */
    private function applyFilters(Builder $query, array $filters): void
    {
        $search = trim((string) ($filters['search'] ?? ''));
        $barangay = trim((string) ($filters['barangay'] ?? ''));
        $workload = (string) ($filters['workload'] ?? '');

        $query->when($search !== '', function (Builder $q) use ($search): void {
            $pattern = Like::contains($search);

            $q->where(function (Builder $group) use ($pattern): void {
                $group->whereRaw('LOWER(users.name) LIKE ?', [$pattern])
                    ->orWhereRaw('LOWER(users.email) LIKE ?', [$pattern])
                    ->orWhereRaw("LOWER(COALESCE(users.username, '')) LIKE ?", [$pattern]);
            });
        });

        $query->when($barangay !== '', function (Builder $q) use ($barangay): void {
            $normalized = Barangays::normalize($barangay);

            $q->whereIn(
                'users.id',
                Beneficiary::query()
                    ->whereNotNull('technician_id')
                    ->where(fn (Builder $address) => $address
                        ->where('address', $normalized)
                        ->orWhere('address', $barangay))
                    ->select('technician_id'),
            );
        });

        $assigned = $this->assignedSql();

        $query->when($workload === 'unassigned', fn (Builder $q) => $q->whereRaw($assigned.' = 0'));
        $query->when(
            $workload === 'light',
            fn (Builder $q) => $q->whereRaw($assigned.' between 1 and '.self::WORKLOAD_LIGHT_MAX),
        );
        $query->when(
            $workload === 'moderate',
            fn (Builder $q) => $q->whereRaw(
                $assigned.' > '.self::WORKLOAD_LIGHT_MAX.' and '.$assigned.' <= '.self::WORKLOAD_MODERATE_MAX,
            ),
        );
        $query->when(
            $workload === 'heavy',
            fn (Builder $q) => $q->whereRaw($assigned.' > '.self::WORKLOAD_MODERATE_MAX),
        );
    }

    private function applyStatus(Builder $query, string $status): void
    {
        if ($status === 'deactivated') {
            $query->onlyTrashed();
        } elseif ($status === 'all') {
            $query->withTrashed();
        } else {
            $query->whereNull('users.deleted_at');
        }
    }

    /** @return array<string, int> */
    private function barangayCountsFor(int $technicianId): array
    {
        return Beneficiary::query()
            ->where('technician_id', $technicianId)
            ->whereNotNull('address')
            ->toBase()
            ->selectRaw('address as name, count(*) as households')
            ->groupBy('address')
            ->orderBy('address')
            ->pluck('households', 'name')
            ->map(fn ($count): int => (int) $count)
            ->all();
    }

    /**
     * Distinct assigned barangays for the technicians on one page.
     *
     * @param  list<int>  $technicianIds
     * @return array<int, list<string>>
     */
    private function barangaysFor(array $technicianIds): array
    {
        if ($technicianIds === []) {
            return [];
        }

        return Beneficiary::query()
            ->whereIn('technician_id', $technicianIds)
            ->whereNotNull('address')
            ->select('technician_id', 'address')
            ->distinct()
            ->orderBy('address')
            ->get()
            ->groupBy('technician_id')
            ->map(fn (Collection $rows): array => $rows->pluck('address')->all())
            ->all();
    }

    /**
     * @param  list<string>  $barangays
     * @return array<string, mixed>
     */
    private function row(User $technician, array $barangays): array
    {
        $assigned = (int) $technician->assigned_households;
        $visited = (int) $technician->visited_households_30d;

        return [
            'id' => (int) $technician->id,
            'name' => $technician->name,
            'username' => $technician->username,
            'email' => $technician->email,
            'avatar_url' => $technician->avatar_url,
            'status' => $technician->deleted_at === null ? 'active' : 'deactivated',
            'created_at' => $technician->created_at?->toIso8601String(),
            'last_login_at' => $technician->last_login_at?->toIso8601String(),
            'assigned_households' => $assigned,
            'visits_completed' => (int) $technician->visits_completed,
            'visits_30d' => (int) $technician->visits_30d,
            'visited_households_30d' => $visited,
            'due_households' => (int) $technician->due_households,
            'coverage_pct' => $assigned > 0
                ? (int) round(min(100, ($visited / $assigned) * 100))
                : null,
            'last_visit_on' => $technician->last_visit_on !== null
                ? substr((string) $technician->last_visit_on, 0, 10)
                : null,
            'barangays' => $barangays,
            'workload' => self::workloadFor($assigned),
        ];
    }

    /**
     * @return array{key: string, label: string, range: string}
     */
    public static function workloadFor(int $assigned): array
    {
        if ($assigned === 0) {
            return [
                'key' => 'unassigned',
                'label' => 'Unassigned',
                'range' => 'No households',
            ];
        }

        if ($assigned <= self::WORKLOAD_LIGHT_MAX) {
            return [
                'key' => 'light',
                'label' => 'Light',
                'range' => '1-'.self::WORKLOAD_LIGHT_MAX.' households',
            ];
        }

        if ($assigned <= self::WORKLOAD_MODERATE_MAX) {
            return [
                'key' => 'moderate',
                'label' => 'Moderate',
                'range' => (self::WORKLOAD_LIGHT_MAX + 1).'-'.self::WORKLOAD_MODERATE_MAX.' households',
            ];
        }

        return [
            'key' => 'heavy',
            'label' => 'Heavy',
            'range' => (self::WORKLOAD_MODERATE_MAX + 1).'+ households',
        ];
    }

    private function assignedSql(): string
    {
        return '(select count(*) from beneficiaries b
            where b.technician_id = users.id and b.deleted_at is null)';
    }

    private function completedVisitsSql(): string
    {
        return '(select count(*) from field_visits fv
            where fv.technician_id = users.id and fv.deleted_at is null)';
    }

    private function recentVisitsSql(): string
    {
        return '(select count(*) from field_visits fv30
            where fv30.technician_id = users.id and fv30.deleted_at is null
            and fv30.visited_on >= ?)';
    }

    private function visitedHouseholdsSql(): string
    {
        return '(select count(distinct fvh.beneficiary_id) from field_visits fvh
            where fvh.technician_id = users.id and fvh.deleted_at is null
            and fvh.visited_on >= ?)';
    }

    private function lastVisitSql(): string
    {
        return '(select max(fvmax.visited_on) from field_visits fvmax
            where fvmax.technician_id = users.id and fvmax.deleted_at is null)';
    }

    private function dueHouseholdsSql(): string
    {
        return '(select count(*) from beneficiaries bd
            where bd.technician_id = users.id and bd.deleted_at is null
            and not exists (select 1 from monitoring_records mr
                where mr.beneficiary_id = bd.id and mr.deleted_at is null
                and mr.date_monitored is not null and mr.date_monitored >= ?)
            and not exists (select 1 from field_visits fvd
                where fvd.beneficiary_id = bd.id and fvd.deleted_at is null
                and fvd.visited_on >= ?))';
    }
}
