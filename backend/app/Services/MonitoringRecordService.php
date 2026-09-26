<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\FieldVisitPhoto;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;

class MonitoringRecordService
{
    public function __construct(private readonly BeneficiaryService $beneficiaries)
    {
    }

    /**
     * Role-scoped monitoring records, newest visits first.
     *
     * Scoping rides on the beneficiary scoping: a technician only ever
     * receives rows whose beneficiary is assigned to them, server-side.
     */
    public function listFor(User $user): LengthAwarePaginator
    {
        $page = $this->scopeFor($user)
            ->with(['beneficiary', 'technician', 'beneficiary.technician'])
            ->latest('date_monitored')
            ->latest('id')
            ->paginate(15);

        $this->attachLatestPhotos($page->getCollection());

        return $page;
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
        return MonitoringRecord::create([
            ...$data,
            'technician_id' => $technician->id,
        ]);
    }

    public function update(MonitoringRecord $record, array $data): MonitoringRecord
    {
        $record->update($data);

        return $record->refresh();
    }

    public function delete(MonitoringRecord $record): void
    {
        $record->delete();
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
