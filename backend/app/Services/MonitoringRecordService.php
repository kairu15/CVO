<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

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
        return $this->scopeFor($user)
            ->with(['beneficiary', 'technician'])
            ->latest('date_monitored')
            ->latest('id')
            ->paginate(15);
    }

    /**
     * Role-scoped single fetch — never 404s a record that merely sits past
     * page one of the index.
     */
    public function findScoped(User $user, int $id): ?MonitoringRecord
    {
        return $this->scopeFor($user)->find($id);
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
