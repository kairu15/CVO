<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\HealthRecord;
use App\Models\User;
use App\Support\Barangays;
use App\Support\Pagination;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class HealthRecordService
{
    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Role-scoped, filtered health records.
     *
     * The status filter is applied before pagination. Healthy/under-observation
     * mean the animal's CURRENT state, so those filters start from the latest
     * examination per household; follow-up filters deliberately operate on
     * every record because an unfinished follow-up does not disappear just
     * because a later examination was entered.
     *
     * @param  array<string, mixed>  $filters
     */
    public function listFor(
        User $user,
        int $perPage = Pagination::DEFAULT_PER_PAGE,
        array $filters = [],
    ): LengthAwarePaginator {
        $status = (string) ($filters['status'] ?? '');

        $query = in_array($status, ['healthy', 'observation'], true)
            ? $this->latestScopeFor($user)
            : $this->scopeFor($user);

        $this->applyFilters($query, $filters);

        $sort = (string) ($filters['sort'] ?? 'date');
        $direction = ($filters['direction'] ?? 'desc') === 'asc' ? 'asc' : 'desc';

        if ($sort === 'farmer') {
            $query->orderBy(
                Beneficiary::query()
                    ->select('name_of_farmer')
                    ->whereColumn('beneficiaries.id', 'health_records.beneficiary_id'),
                $direction,
            );
        } else {
            $query->orderBy('date_recorded', $direction);
        }

        return $query
            ->orderBy('id', $direction)
            ->with(['beneficiary', 'doctor'])
            ->paginate($perPage)
            ->withQueryString();
    }

    /**
     * One scoped record. The controller adds the beneficiary's examination
     * history for the detail drawer.
     */
    public function findScoped(User $user, int $id): ?HealthRecord
    {
        return $this->scopeFor($user)->find($id);
    }

    /**
     * The four overview figures plus the follow-up worklist counters. One
     * scoped aggregate request, never a client-side count over a page.
     *
     * @return array<string, int>
     */
    public function summaryFor(User $user): array
    {
        $total = $this->scopeFor($user)->count();

        $healthy = $this->latestScopeFor($user)
            ->where('outcome', 'recovered')
            ->count();

        $observation = $this->latestScopeFor($user)
            ->where(function (Builder $query): void {
                $query->whereNull('outcome')
                    ->orWhereIn('outcome', ['improving', 'ongoing']);
            })
            ->count();

        $pending = $this->scopeFor($user)
            ->whereNotNull('follow_up_on')
            ->whereNull('follow_up_completed_at');

        return [
            'total_health_records' => $total,
            'healthy_animals' => $healthy,
            'observation_animals' => $observation,
            'follow_up_required' => (clone $pending)->count(),
            'follow_up_overdue' => (clone $pending)
                ->whereDate('follow_up_on', '<', today()->toDateString())
                ->count(),
            'follow_up_upcoming' => (clone $pending)
                ->whereDate('follow_up_on', '>=', today()->toDateString())
                ->count(),
            'follow_up_completed' => $this->scopeFor($user)
                ->whereNotNull('follow_up_completed_at')
                ->count(),
        ];
    }

    /**
     * The role-scoped base query: rows visible to this user only.
     */
    protected function scopeFor(User $user): Builder
    {
        $beneficiaryIds = $this->beneficiaries->scopeQueryFor($user)->select('id');

        return HealthRecord::query()->whereIn('beneficiary_id', $beneficiaryIds);
    }

    /**
     * The newest examination per household. Correlated rather than a
     * MAX(id) shortcut: a backdated record entered later must not hide the
     * actual latest examination. Ties on date resolve by id.
     */
    protected function latestScopeFor(User $user): Builder
    {
        return $this->scopeFor($user)->whereNotExists(function ($query): void {
            $query->selectRaw('1')
                ->from('health_records as newer_health_records')
                ->whereColumn('newer_health_records.beneficiary_id', 'health_records.beneficiary_id')
                ->whereNull('newer_health_records.deleted_at')
                ->where(function ($newer): void {
                    $newer->whereColumn('newer_health_records.date_recorded', '>', 'health_records.date_recorded')
                        ->orWhere(function ($sameDay): void {
                            $sameDay->whereColumn('newer_health_records.date_recorded', '=', 'health_records.date_recorded')
                                ->whereColumn('newer_health_records.id', '>', 'health_records.id');
                        });
                });
        });
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    protected function applyFilters(Builder $query, array $filters): void
    {
        $search = trim((string) ($filters['search'] ?? ''));
        $barangay = trim((string) ($filters['barangay'] ?? ''));
        $status = (string) ($filters['status'] ?? '');
        $from = $filters['from'] ?? null;
        $to = $filters['to'] ?? null;

        $query
            ->when($search !== '', function (Builder $query) use ($search): void {
                $query->where(function (Builder $group) use ($search): void {
                    $group->whereLike('diagnosis', "%{$search}%")
                        ->orWhereLike('symptoms', "%{$search}%")
                        ->orWhereLike('treatment', "%{$search}%")
                        ->orWhereLike('remarks', "%{$search}%")
                        ->orWhereHas('beneficiary', function (Builder $household) use ($search): void {
                            $household->whereLike('name_of_farmer', "%{$search}%")
                                ->orWhereLike('rsbsa_number', "%{$search}%")
                                ->orWhereLike('ear_tag_number', "%{$search}%")
                                ->orWhereLike('animal_type', "%{$search}%")
                                ->orWhereLike('address', "%{$search}%");
                        });
                });
            })
            ->when($barangay !== '', fn (Builder $query) => $query->whereHas(
                'beneficiary',
                fn (Builder $household) => $household->where('address', Barangays::normalize($barangay)),
            ))
            ->when($status === 'healthy', fn (Builder $query) => $query->where('outcome', 'recovered'))
            ->when($status === 'observation', fn (Builder $query) => $query->where(function (Builder $group): void {
                $group->whereNull('outcome')->orWhereIn('outcome', ['improving', 'ongoing']);
            }))
            ->when($status === 'follow_up', fn (Builder $query) => $query
                ->whereNotNull('follow_up_on')
                ->whereNull('follow_up_completed_at'))
            ->when($status === 'overdue', fn (Builder $query) => $query
                ->whereNotNull('follow_up_on')
                ->whereNull('follow_up_completed_at')
                ->whereDate('follow_up_on', '<', today()->toDateString()))
            ->when($status === 'upcoming', fn (Builder $query) => $query
                ->whereNotNull('follow_up_on')
                ->whereNull('follow_up_completed_at')
                ->whereDate('follow_up_on', '>=', today()->toDateString()))
            ->when($status === 'completed', fn (Builder $query) => $query
                ->whereNotNull('follow_up_completed_at'))
            ->when($from, fn (Builder $query) => $query->whereDate('date_recorded', '>=', $from))
            ->when($to, fn (Builder $query) => $query->whereDate('date_recorded', '<=', $to));
    }

    /**
     * Author a health record. The technician is recorded as its author
     * (`doctor_id` — the attending veterinarian, a schema name); eligibility
     * is enforced by StoreHealthRecordRequest.
     */
    public function create(User $author, array $data): HealthRecord
    {
        $record = HealthRecord::create([
            ...$data,
            'animal_quantity' => $data['animal_quantity'] ?? 1,
            'doctor_id' => $author->id,
        ]);

        $this->audit->log($author, 'health_record_created', $record);

        return $record;
    }

    public function update(User $actor, HealthRecord $record, array $data): HealthRecord
    {
        $completed = array_key_exists('follow_up_completed', $data)
            ? (bool) $data['follow_up_completed']
            : null;

        unset($data['follow_up_completed']);

        if (array_key_exists('follow_up_on', $data)) {
            $newDate = $data['follow_up_on'];
            $oldDate = $record->follow_up_on?->toDateString();

            // Clearing the schedule clears its completion too. Moving the
            // schedule to another day reopens the follow-up unless the same
            // request explicitly marks it complete.
            if ($newDate === null || (string) $newDate !== $oldDate) {
                if ($completed !== true) {
                    $data['follow_up_completed_at'] = null;
                }
            }
        }

        if ($completed === true) {
            $data['follow_up_completed_at'] = $record->follow_up_completed_at ?? now();
        } elseif ($completed === false) {
            $data['follow_up_completed_at'] = null;
        }

        $record->update($data);

        $this->audit->log($actor, 'health_record_updated', $record);

        return $record->refresh();
    }

    public function delete(User $actor, HealthRecord $record): void
    {
        $record->delete();

        $this->audit->log($actor, 'health_record_deleted', $record);
    }
}
