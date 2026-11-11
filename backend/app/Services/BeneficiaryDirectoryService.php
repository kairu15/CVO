<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\User;
use App\Support\Barangays;
use App\Support\Like;
use App\Support\Pagination;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\LazyCollection;

/**
 * The admin beneficiary directory: one filter set shared by the list, the
 * barangay header totals, the KPI strip, the id list behind "select all
 * matching", the CSV export and the enrolment duplicate check.
 *
 * Keeping every read on this single query is what stops the page from
 * disagreeing with itself — a badge counting rows on this page while the tile
 * counts the program, or an export that ignores the filter on screen.
 */
class BeneficiaryDirectoryService
{
    /** Households with no dated visit in this many days are overdue. */
    public const OVERDUE_DAYS = 60;

    /** Ceiling on an id payload so "select all" stays one bounded request. */
    public const MAX_IDS = 10_000;

    /**
     * The filtered household query (no eager loads or ordering).
     *
     * @param  array<string, mixed>  $filters
     */
    private function filtered(User $user, array $filters): Builder
    {
        $query = Beneficiary::query();

        $this->applyFilters($query, $filters);

        return $query;
    }

    /**
     * Apply the directory's filters in one place.
     *
     * @param  array<string, mixed>  $filters
     */
    public function applyFilters(Builder $query, array $filters): void
    {
        $search = trim((string) ($filters['search'] ?? ''));
        $barangay = trim((string) ($filters['barangay'] ?? ''));
        $animalType = trim((string) ($filters['animal_type'] ?? ''));
        $animalTypeId = $filters['animal_type_id'] ?? null;
        $classificationId = $filters['classification_id'] ?? null;
        $assignment = (string) ($filters['assignment'] ?? '');
        $monitoring = (string) ($filters['monitoring'] ?? '');
        $missing = (string) ($filters['missing'] ?? '');

        // Search spans the four identifiers staff actually use: farmer name,
        // RSBSA #, ear tag # and the assigned technician, plus the barangay.
        $query->when($search !== '', function (Builder $q) use ($search): void {
            $pattern = Like::contains($search);

            $q->where(function (Builder $group) use ($pattern): void {
                $group->whereRaw('LOWER(name_of_farmer) LIKE ?', [$pattern])
                    ->orWhereRaw("LOWER(COALESCE(rsbsa_number, '')) LIKE ?", [$pattern])
                    ->orWhereRaw("LOWER(COALESCE(ear_tag_number, '')) LIKE ?", [$pattern])
                    ->orWhereRaw('LOWER(address) LIKE ?', [$pattern])
                    ->orWhereRaw('LOWER(animal_type) LIKE ?', [$pattern])
                    ->orWhereHas(
                        'technician',
                        fn (Builder $tq) => $tq->whereRaw('LOWER(name) LIKE ?', [$pattern]),
                    );
            });
        });

        // Canonical spelling first, raw value as the fallback for historical
        // addresses that differ in punctuation.
        $query->when($barangay !== '', fn (Builder $q) => $q->where(
            fn (Builder $w) => $w->where('address', Barangays::normalize($barangay))
                ->orWhere('address', $barangay),
        ));

        $query->when($animalType !== '', function (Builder $q) use ($animalType, $animalTypeId): void {
            $resolvedId = $animalTypeId !== null && $animalTypeId !== ''
                ? (int) $animalTypeId
                : app(AnimalTypeCatalog::class)->resolveType($animalType)?->id;

            $q->where(function (Builder $w) use ($animalType, $resolvedId): void {
                $w->where('animal_type', $animalType);

                if ($resolvedId !== null) {
                    $w->orWhere('animal_type_id', $resolvedId);
                }
            });
        });

        $query->when(
            $animalTypeId !== null && $animalTypeId !== '',
            fn (Builder $q) => $q->where('animal_type_id', (int) $animalTypeId),
        );

        $query->when(
            $classificationId !== null && $classificationId !== '',
            fn (Builder $q) => $q->where('classification_id', (int) $classificationId),
        );

        // Assignment: unassigned, or one technician's households.
        $query->when($assignment === 'unassigned', fn (Builder $q) => $q->whereNull('technician_id'));
        $query->when(
            $assignment !== '' && $assignment !== 'unassigned' && ctype_digit($assignment),
            fn (Builder $q) => $q->where('technician_id', (int) $assignment),
        );

        // Never = no dated visit at all. Overdue = no dated visit inside the
        // window, which deliberately includes the never-visited households.
        // A field visit counts as contact: the directory and the Field Visits
        // log must not disagree about who has actually been seen.
        $cutoff = now()->subDays(self::OVERDUE_DAYS)->toDateString();

        $query->when(
            $monitoring === 'never',
            fn (Builder $q) => $q->whereDoesntHave(
                'monitoringRecords',
                fn (Builder $m) => $m->whereNotNull('date_monitored'),
            )->whereDoesntHave('fieldVisits'),
        );
        $query->when(
            $monitoring === 'overdue',
            fn (Builder $q) => $q->whereDoesntHave(
                'monitoringRecords',
                fn (Builder $m) => $m->whereNotNull('date_monitored')
                    ->where('date_monitored', '>=', $cutoff),
            )->whereDoesntHave(
                'fieldVisits',
                fn (Builder $v) => $v->where('visited_on', '>=', $cutoff),
            ),
        );

        $query->when(
            $missing === 'rsbsa',
            fn (Builder $q) => $q->where(
                fn (Builder $w) => $w->whereNull('rsbsa_number')->orWhere('rsbsa_number', ''),
            ),
        );
        $query->when(
            $missing === 'ear_tag',
            fn (Builder $q) => $q->where(
                fn (Builder $w) => $w->whereNull('ear_tag_number')->orWhere('ear_tag_number', ''),
            ),
        );
        $query->when(
            $missing === 'location',
            fn (Builder $q) => $q->where(
                fn (Builder $w) => $w->whereNull('latitude')->orWhereNull('longitude'),
            ),
        );
    }

    /**
     * One page of the directory.
     *
     * @param  array<string, mixed>  $filters
     */
    public function listFor(User $user, array $filters, ?int $perPage = null): LengthAwarePaginator
    {
        return $this->filtered($user, $filters)
            ->with(['technician', 'animalType', 'animalClassification'])
            ->withCount(['monitoringRecords', 'fieldVisits'])
            ->withMax('monitoringRecords as monitoring_records_max_date_monitored', 'date_monitored')
            ->withMax('fieldVisits as field_visits_max_visited_on', 'visited_on')
            ->orderBy('address')
            ->orderBy('name_of_farmer')
            ->paginate(Pagination::perPage($perPage));
    }

    /**
     * TRUE household count per barangay header, over the filtered set.
     *
     * @param  array<string, mixed>  $filters
     * @return array<string, int>
     */
    public function groupTotalsFor(User $user, array $filters): array
    {
        return $this->filtered($user, $filters)
            ->reorder()
            ->toBase()
            ->selectRaw('address as group_key, count(*) as aggregate')
            ->groupBy('address')
            ->pluck('aggregate', 'group_key')
            ->map(fn ($count) => (int) $count)
            ->all();
    }

    /**
     * The KPI strip, program-wide.
     *
     * @return array<string, mixed>
     */
    public function summaryFor(User $user): array
    {
        $cutoff = now()->subDays(self::OVERDUE_DAYS)->toDateString();

        return [
            'households' => Beneficiary::query()->count(),
            'unassigned' => Beneficiary::query()->whereNull('technician_id')->count(),
            'never_monitored' => Beneficiary::query()
                ->whereDoesntHave(
                    'monitoringRecords',
                    fn (Builder $q) => $q->whereNotNull('date_monitored'),
                )
                ->whereDoesntHave('fieldVisits')
                ->count(),
            'overdue' => Beneficiary::query()
                ->whereDoesntHave(
                    'monitoringRecords',
                    fn (Builder $q) => $q->whereNotNull('date_monitored')
                        ->where('date_monitored', '>=', $cutoff),
                )
                ->whereDoesntHave(
                    'fieldVisits',
                    fn (Builder $q) => $q->where('visited_on', '>=', $cutoff),
                )
                ->count(),
            'overdue_days' => self::OVERDUE_DAYS,
            'missing_rsbsa' => Beneficiary::query()
                ->where(fn (Builder $q) => $q->whereNull('rsbsa_number')->orWhere('rsbsa_number', ''))
                ->count(),
            'missing_ear_tag' => Beneficiary::query()
                ->where(fn (Builder $q) => $q->whereNull('ear_tag_number')->orWhere('ear_tag_number', ''))
                ->count(),
            'without_location' => Beneficiary::query()
                ->where(fn (Builder $q) => $q->whereNull('latitude')->orWhereNull('longitude'))
                ->count(),
            'moa_unsigned' => Beneficiary::query()
                ->where(fn (Builder $q) => $q->whereNull('moa_signed')->orWhere('moa_signed', false))
                ->count(),
        ];
    }

    /**
     * Every id matching the active filters — "select all N matching".
     *
     * @param  array<string, mixed>  $filters
     * @return list<int>
     */
    public function idsFor(User $user, array $filters): array
    {
        return $this->filtered($user, $filters)
            ->orderBy('address')
            ->orderBy('name_of_farmer')
            ->limit(self::MAX_IDS)
            ->pluck('id')
            ->all();
    }

    /**
     * The filtered directory as a lazy row stream for the CSV export.
     *
     * @param  array<string, mixed>  $filters
     * @return LazyCollection<int, Beneficiary>
     */
    public function rowsFor(User $user, array $filters): LazyCollection
    {
        return $this->filtered($user, $filters)
            ->with(['technician', 'animalType', 'animalClassification'])
            ->withCount(['monitoringRecords', 'fieldVisits'])
            ->withMax('monitoringRecords as monitoring_records_max_date_monitored', 'date_monitored')
            ->withMax('fieldVisits as field_visits_max_visited_on', 'visited_on')
            ->orderBy('address')
            ->orderBy('name_of_farmer')
            ->lazy(200);
    }

    /**
     * Households that look like the one being enrolled: same RSBSA number, or
     * the same farmer name in the same barangay. A warning, never a block.
     *
     * @param  array<string, mixed>  $data
     * @return Collection<int, Beneficiary>
     */
    public function duplicatesFor(array $data): Collection
    {
        $rsbsa = trim((string) ($data['rsbsa_number'] ?? ''));
        $name = trim((string) ($data['name_of_farmer'] ?? ''));
        $address = trim((string) ($data['address'] ?? ''));

        if ($rsbsa === '' && ($name === '' || $address === '')) {
            return collect();
        }

        return Beneficiary::query()
            ->where(function (Builder $query) use ($rsbsa, $name, $address): void {
                if ($rsbsa !== '') {
                    $query->whereRaw('LOWER(rsbsa_number) = ?', [mb_strtolower($rsbsa)]);
                }

                if ($name !== '' && $address !== '') {
                    $match = function (Builder $w) use ($name, $address): void {
                        $w->whereRaw('LOWER(name_of_farmer) = ?', [mb_strtolower($name)])
                            ->whereRaw('LOWER(address) = ?', [mb_strtolower($address)]);
                    };

                    $rsbsa !== '' ? $query->orWhere($match) : $query->where($match);
                }
            })
            ->limit(5)
            ->get(['id', 'name_of_farmer', 'address', 'rsbsa_number']);
    }
}
