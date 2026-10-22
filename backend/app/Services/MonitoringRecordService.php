<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\FieldVisitPhoto;
use App\Models\MonitoringRecord;
use App\Models\User;
use App\Support\Like;
use App\Support\Pagination;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;

class MonitoringRecordService
{
    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
        private readonly AuditLogger $audit,
    ) {
    }

    /**
     * Role-scoped monitoring records, newest visits first.
     *
     * Scoping rides on the beneficiary scoping: a technician only ever
     * receives rows whose beneficiary is assigned to them, server-side.
     *
     * `$month` ("YYYY-MM") filters on `date_monitored` — the field the CVO
     * report is organized by, not the row's creation timestamp. The filter
     * runs INSIDE the database query and before pagination, so the total
     * count for the month is the real total, never a page-sized slice.
     *
     * `$search` matches the farmer's name on the joined beneficiary — the
     * identity column the monitoring sheet is keyed by — and for the same
     * reason runs before pagination: filtering the fetched page client-side
     * would hide matches that happen to sort onto a later page.
     */
    public function listFor(
        User $user,
        ?string $month = null,
        ?string $search = null,
        int $perPage = Pagination::DEFAULT_PER_PAGE,
        ?string $animalType = null,
        string $sort = 'date',
        ?int $animalTypeId = null,
        ?int $classificationId = null,
    ): LengthAwarePaginator {
        // A legacy name ("Carabao") resolves to the master type it clearly
        // means, so filtering by the catalogue's own name ("Carabao (Water
        // Buffalo)") still catches rows whose display string predates the
        // migration. An ambiguous or unknown name resolves to null and keeps
        // the exact string match it has always had.
        $resolvedAnimalTypeId = $animalType !== null && trim($animalType) !== ''
            ? app(AnimalTypeCatalog::class)->resolveType($animalType)?->id
            : null;

        $page = $this->scopeFor($user)
            ->with([
                'beneficiary',
                'beneficiary.technician',
                'beneficiary.animalType',
                'beneficiary.animalClassification',
                'technician',
            ])
            ->when($month !== null, fn (Builder $q) => $this->applyMonthFilter($q, $month))
            // Animal type lives on the beneficiary. Filtering with whereHas
            // keeps it a database WHERE (before pagination), so the month and
            // animal filters combine with AND and `meta.total` is the real
            // filtered count — never a client-side slice of one page.
            //
            // Two keys are accepted: the LEGACY free-text value (what the
            // monitoring table's data-derived filter sends, and what every
            // historical row carries) and the master-list id (what the
            // cascading select sends). Filtering by id is what makes the new
            // structured list authoritative; the string stays for rows the
            // migration could not map.
            ->when(
                $animalType !== null && trim($animalType) !== '',
                fn (Builder $q) => $q->whereHas(
                    'beneficiary',
                    fn (Builder $bq) => $bq->where('animal_type', $animalType)
                        ->when(
                            $resolvedAnimalTypeId !== null,
                            fn (Builder $iq) => $iq->orWhere('animal_type_id', $resolvedAnimalTypeId),
                        ),
                ),
            )
            ->when(
                $animalTypeId !== null,
                fn (Builder $q) => $q->whereHas(
                    'beneficiary',
                    fn (Builder $bq) => $bq->where('animal_type_id', $animalTypeId),
                ),
            )
            ->when(
                $classificationId !== null,
                fn (Builder $q) => $q->whereHas(
                    'beneficiary',
                    fn (Builder $bq) => $bq->where('classification_id', $classificationId),
                ),
            )
            ->when(
                $sort === 'animal_type',
                function (Builder $q): void {
                    // Order by the beneficiary's type first (alphabetical), so
                    // the table's grouping runs over rows the DATABASE already
                    // ordered — not an array sort in PHP or JS. The master
                    // list's name wins; an unmapped historical row falls back
                    // to its legacy string so it still groups sensibly. The
                    // date/id tie-breakers below stay the secondary order
                    // within a group.
                    $q->orderByRaw(
                        'coalesce('
                        .'(select animal_types.name from animal_types'
                        .' inner join beneficiaries as type_owner on type_owner.animal_type_id = animal_types.id'
                        .' where type_owner.id = monitoring_records.beneficiary_id),'
                        .'(select beneficiaries.animal_type from beneficiaries'
                        .' where beneficiaries.id = monitoring_records.beneficiary_id)'
                        .')'
                    );
                },
            )
            ->when(
                $search !== null && trim($search) !== '',
                function (Builder $q) use ($search): void {
                    // `Like::contains` neutralizes LIKE wildcards and
                    // lowercases, so the match is case-insensitive on SQLite
                    // (tests) and MySQL alike.
                    $pattern = Like::contains($search);

                    $q->whereHas(
                        'beneficiary',
                        fn (Builder $bq) => $bq->whereRaw('LOWER(name_of_farmer) LIKE ?', [$pattern]),
                    );
                },
            )
            ->latest('date_monitored')
            ->latest('id')
            ->paginate($perPage);

        $this->attachLatestPhotos($page->getCollection());

        return $page;
    }

    /**
     * The "YYYY-MM" bucket a record belongs to, by `date_monitored`.
     * Null (import rows can carry no date) buckets as null — callers decide
     * how to surface that; the export groups them under "Unlisted".
     */
    public static function monthKey(MonitoringRecord $record): ?string
    {
        return $record->date_monitored?->format('Y-m');
    }

    /**
     * The distinct months that actually have records, oldest first, scoped
     * to the caller. This is the month-tab list — only months with data
     * appear, exactly like the Excel export only emits sheets with data.
     *
     * One query over the indexed `date_monitored` column; the "YYYY-MM"
     * prefix sorts chronologically as a plain string on MySQL and SQLite
     * alike (the test harness runs the latter).
     */
    public function availableMonthsFor(User $user): array
    {
        return $this->scopeFor($user)
            ->whereNotNull('date_monitored')
            ->toBase()
            ->selectRaw('distinct substr(date_monitored, 1, 7) as month')
            ->orderBy('month')
            ->pluck('month')
            ->all();
    }

    /**
     * The distinct animal types actually present in the caller's records,
     * alphabetical — the type-filter option list.
     *
     * Built from the data (beneficiaries joined to the scoped records), not a
     * hardcoded list, for the same reason the month list is: an option with
     * no rows would just show an empty table. Covers imported and
     * UI-registered households alike, since both store `animal_type` on the
     * beneficiary.
     *
     * @return list<string>
     */
    public function availableAnimalTypesFor(User $user): array
    {
        return $this->scopeFor($user)
            ->join('beneficiaries', 'beneficiaries.id', '=', 'monitoring_records.beneficiary_id')
            ->whereNull('beneficiaries.deleted_at')
            ->whereNotNull('beneficiaries.animal_type')
            ->where('beneficiaries.animal_type', '!=', '')
            ->toBase()
            ->distinct()
            ->orderBy('beneficiaries.animal_type')
            ->pluck('beneficiaries.animal_type')
            ->all();
    }

    /** Constrain a query to one "YYYY-MM" bucket of `date_monitored`. */
    private function applyMonthFilter(Builder $query, string $month): void
    {
        $query->whereYear('date_monitored', '=', (int) substr($month, 0, 4))
            ->whereMonth('date_monitored', '=', (int) substr($month, 5, 2));
    }

    /**
     * Attach each record's beneficiary's most recent field-visit photo.
     *
     * A photo hangs off a field VISIT, not off a monitoring record, so the
     * path is record → beneficiary → visits → photos. "Most recent" is
     * decided explicitly in SQL — one ranked query per page, window-
     * partitioned by beneficiary and ordered capture date desc, capture
     * time desc, then id desc as the deterministic tie-break — never by
     * array order:
     *
     *     select ... from field_visit_photos
     *     join field_visits ...
     *     where beneficiary_id in (…)            -- one query for the page
     *     and row_number() over (
     *         partition by beneficiary_id
     *         order by capture_date desc, capture_time desc, id desc
     *     ) = 1
     *
     * Public because the Excel export reuses the same rule — the sheet and
     * the on-screen table must not disagree.
     *
     * @param  EloquentCollection<int, MonitoringRecord>  $records
     */
    public function attachLatestPhotos(EloquentCollection $records): void
    {
        $beneficiaries = $records
            ->map(fn (MonitoringRecord $record) => $record->beneficiary)
            ->filter()
            ->unique('id');

        if ($beneficiaries->isEmpty()) {
            return;
        }

        $photoByBeneficiary = FieldVisitPhoto::query()
            ->join('field_visits', 'field_visits.id', '=', 'field_visit_photos.field_visit_id')
            // The joined visits are outside FieldVisitPhoto's own SoftDeletes
            // scope, so filter them explicitly alongside the photos.
            ->whereNull('field_visits.deleted_at')
            ->whereIn('field_visits.beneficiary_id', $beneficiaries->modelKeys())
            // field_visit_photos.* carries no beneficiary_id, so the joined
            // column can ride along under the same name without colliding —
            // the map below needs it and must not lazy-load per photo.
            ->select('field_visit_photos.*')
            ->addSelect('field_visits.beneficiary_id')
            ->selectRaw(
                'row_number() over ('
                .'partition by field_visits.beneficiary_id '
                .'order by field_visit_photos.capture_date desc, '
                .'field_visit_photos.capture_time desc, '
                .'field_visit_photos.id desc'
                .') as rn'
            )
            ->get()
            ->filter(fn (FieldVisitPhoto $photo) => $photo->rn === 1)
            ->mapWithKeys(fn (FieldVisitPhoto $photo) => [
                $photo->beneficiary_id => $photo,
            ]);

        foreach ($records as $record) {
            $record->beneficiary?->setRelation(
                'latestFieldVisitPhoto',
                $photoByBeneficiary[$record->beneficiary->id] ?? null,
            );
        }
    }

    /**
     * Role-scoped single fetch — never 404s a record that merely sits past
     * page one of the index.
     */
    public function findScoped(User $user, int $id): ?MonitoringRecord
    {
        $record = $this->scopeFor($user)->find($id);

        if ($record) {
            $record->load([
                'beneficiary',
                'technician',
                'beneficiary.technician',
                'beneficiary.animalType',
                'beneficiary.animalClassification',
            ]);
            $this->attachLatestPhotos(new EloquentCollection([$record]));
        }

        return $record;
    }

    /**
     * The role-scoped base query: rows visible to this user only.
     */
    protected function scopeFor(User $user): \Illuminate\Database\Eloquent\Builder
    {
        $beneficiaryIds = $this->beneficiaries->scopeQueryFor($user)->select('id');

        return MonitoringRecord::query()->whereIn('beneficiary_id', $beneficiaryIds);
    }

    /**
     * Log a monitoring visit. The actor is always recorded as the
     * technician of the visit; assignment is verified by the FormRequest.
     */
    public function create(User $technician, array $data): MonitoringRecord
    {
        $record = MonitoringRecord::create([
            ...$data,
            'technician_id' => $technician->id,
        ]);

        $this->audit->log($technician, 'monitoring_created', $record);

        return $record;
    }

    public function update(User $actor, MonitoringRecord $record, array $data): MonitoringRecord
    {
        $record->update($data);

        $this->audit->log($actor, 'monitoring_updated', $record);

        return $record->refresh();
    }

    /**
     * Delete a monitoring record.
     *
     * An IMPORT-created record (source = import): deleting the sheet row also
     * removes its auto-created beneficiary when nothing else still references
     * it, so a deleted import stops resurfacing as a phantom household in
     * Beneficiaries, the map and the technician pickers. Any other row — a
     * technician's visit, or a beneficiary's first (enrolment) record — is a
     * plain record-only delete, all inside ONE transaction.
     */
    public function delete(User $actor, MonitoringRecord $record): void
    {
        \Illuminate\Support\Facades\DB::transaction(function () use ($record): void {
            $beneficiary = $record->beneficiary;

            $record->delete();

            if (! $beneficiary instanceof Beneficiary
                || $beneficiary->source !== Beneficiary::SOURCE_IMPORT) {
                return;
            }

            $stillReferenced = $beneficiary->monitoringRecords()->exists()
                || $beneficiary->fieldVisits()->exists()
                || $beneficiary->healthRecords()->exists()
                || $beneficiary->caseNotes()->exists()
                || $beneficiary->dispersalEvents()->exists()
                || \App\Models\DispersalEvent::query()
                    ->where('parent_beneficiary_id', $beneficiary->id)
                    ->orWhere('new_beneficiary_id', $beneficiary->id)
                    ->exists();

            if (! $stillReferenced) {
                $beneficiary->delete();
            }
        });

        $this->audit->log($actor, 'monitoring_deleted', $record);
    }

    /**
     * Flip the MOA status recorded for the beneficiary behind a monitoring
     * record.
     *
     * The agreement is per DISPERSAL, which in this system is the beneficiary
     * (animal + household) row — so this writes the beneficiary, not the
     * individual visit. Every visit row for that beneficiary then shows the
     * same badge, which is why the monitoring page refreshes its rows after
     * the save rather than patching just the clicked one.
     *
     * Authorized by the caller before this runs (MonitoringRecordPolicy::setMoa
     * — the `monitoring.set-moa` capability, seeded admin-only).
     */
    public function setMoa(MonitoringRecord $record, bool $signed, User $actor): MonitoringRecord
    {
        $beneficiary = $record->beneficiary;

        if ($beneficiary instanceof Beneficiary) {
            $beneficiary->update(['moa_signed' => $signed]);

            $this->audit->log($actor, 'monitoring_moa_updated', $beneficiary, [
                'beneficiary_id' => $beneficiary->id,
                'moa_signed' => $signed,
            ]);
        }

        return $record->refresh();
    }

    /**
     * Beneficiaries a technician can log visits for right now — used to
     * populate the "Log a Visit" form picker.
     */
    public function assignableBeneficiariesFor(User $technician)
    {
        return Beneficiary::query()
            ->where('technician_id', $technician->id)
            ->withCount('monitoringRecords')
            ->orderBy('name_of_farmer')
            ->get();
    }
}
