<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\FieldVisitPhoto;
use App\Models\MonitoringRecord;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\Like;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;

class MonitoringRecordService
{
    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
        private readonly NotificationService $notifications,
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
        int $perPage = 15,
        ?string $animalType = null,
        string $sort = 'date',
    ): LengthAwarePaginator {
        $page = $this->scopeFor($user)
            ->with(['beneficiary', 'technician', 'beneficiary.technician'])
            ->when($month !== null, fn (Builder $q) => $this->applyMonthFilter($q, $month))
            // Animal type lives on the beneficiary. Filtering with whereHas
            // keeps it a database WHERE (before pagination), so the month and
            // animal filters combine with AND and `meta.total` is the real
            // filtered count — never a client-side slice of one page.
            ->when(
                $animalType !== null && trim($animalType) !== '',
                fn (Builder $q) => $q->whereHas(
                    'beneficiary',
                    fn (Builder $bq) => $bq->where('animal_type', $animalType),
                ),
            )
            ->when(
                $sort === 'animal_type',
                function (Builder $q): void {
                    // Order by the beneficiary's type first (alphabetical), so
                    // the table's grouping runs over rows the DATABASE already
                    // ordered — not an array sort in PHP or JS. The date/id
                    // tie-breakers below stay the secondary order within a
                    // group.
                    $q->orderBy(
                        Beneficiary::query()
                            ->select('animal_type')
                            ->whereColumn('beneficiaries.id', 'monitoring_records.beneficiary_id')
                            ->limit(1),
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
            $record->load(['beneficiary', 'technician', 'beneficiary.technician']);
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
     * Three cases, all inside ONE transaction so the delete is all-or-nothing:
     *
     *  1. A REGISTRATION-created row (registration_status != none) IS the
     *     farmer's registration. An admin deleting it is deleting the farmer,
     *     so the household, its whole history and its account are soft-deleted
     *     together — see BeneficiaryService::deleteFarmer(). This is what
     *     fixes the orphaned-records bug: the row used to disappear while the
     *     account, assignment, visits and notifications stayed behind.
     *
     *  2. An IMPORT-created record (source = import): deleting the sheet row
     *     also removes its auto-created beneficiary when nothing else still
     *     references it, so a deleted import stops resurfacing as a phantom
     *     household in Beneficiaries, the map and the technician pickers.
     *
     *  3. An ordinary visit row (registration_status = none) on a registered
     *     household: record-only delete. A technician clearing a bad entry
     *     must not wipe the farmer.
     */
    public function delete(User $actor, MonitoringRecord $record): void
    {
        \Illuminate\Support\Facades\DB::transaction(function () use ($record, $actor): void {
            $beneficiary = $record->beneficiary;

            if ($record->registration_status !== MonitoringRecord::REGISTRATION_NONE
                && $beneficiary instanceof Beneficiary) {
                $this->beneficiaries->deleteFarmer($actor, $beneficiary);

                return;
            }

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
     * Accept a registration-created record: the admin has seen it. The
     * green highlight and "New" badge stay until the upcoming midnight
     * (app timezone), then the scheduler flips the row to `old`.
     */
    public function accept(MonitoringRecord $record, User $acceptor): MonitoringRecord
    {
        $record->forceFill([
            'registration_status' => MonitoringRecord::REGISTRATION_ACCEPTED,
            'accepted_at' => now(),
            'status_expires_at' => now()->addDay()->startOfDay(),
        ])->save();

        $this->audit->log($acceptor, 'monitoring_accepted', $record);

        // Tell the farmer their registration was reviewed, and the other
        // admins so nobody re-reviews an already-accepted row.
        $farmerUser = $record->beneficiary?->farmer_id;

        if ($farmerUser) {
            $this->notifications->create($farmerUser instanceof User ? $farmerUser : User::find($farmerUser), [
                'type' => UserNotification::TYPE_REGISTRATION_ACCEPTED,
                'actor_id' => $acceptor->id,
                'beneficiary_id' => $record->beneficiary_id,
                'monitoring_record_id' => $record->id,
                'title' => 'Registration accepted',
                'message' => "The CVO accepted the dispersal registration for {$record->beneficiary->name_of_farmer}.",
                'link' => '/dashboard/farmer/monitoring',
            ]);
        }

        User::query()->where('role', 'admin')->where('id', '!=', $acceptor->id)->get()->each(
            fn (User $admin) => $this->notifications->create($admin, [
                'type' => UserNotification::TYPE_REGISTRATION_ACCEPTED,
                'actor_id' => $acceptor->id,
                'beneficiary_id' => $record->beneficiary_id,
                'monitoring_record_id' => $record->id,
                'title' => 'Registration accepted',
                'message' => "{$acceptor->name} accepted the registration for {$record->beneficiary->name_of_farmer}.",
                'link' => '/dashboard/admin/monitoring',
            ]),
        );

        return $record->refresh();
    }

    /**
     * Midnight expiry: everything whose countdown has passed becomes `old`.
     * Covers both accepted records and `new` records nobody acted on — the
     * admin chose auto-expiry so nothing stays green unattended.
     *
     * @return int rows flipped
     */
    public function expireDueRegistrations(): int
    {
        return MonitoringRecord::query()
            ->whereIn('registration_status', [
                MonitoringRecord::REGISTRATION_NEW,
                MonitoringRecord::REGISTRATION_ACCEPTED,
            ])
            ->whereNotNull('status_expires_at')
            ->where('status_expires_at', '<=', now())
            ->update([
                'registration_status' => MonitoringRecord::REGISTRATION_OLD,
                'status_expires_at' => null,
            ]);
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
