<?php

namespace App\Services;

use App\Models\HealthRecord;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class HealthRecordService
{
    public function __construct(private readonly BeneficiaryService $beneficiaries)
    {
    }

    /**
     * Role-scoped health records, most recent first.
     *
     * Scoping rides on the beneficiary scoping — the same rule the monitoring
     * records use — so a technician only ever receives records for assigned
     * beneficiaries and a farmer only their own, server-side.
     */
    public function listFor(User $user): LengthAwarePaginator
    {
        return $this->scopeFor($user)
            ->with(['beneficiary', 'doctor'])
            ->latest('date_recorded')
            ->latest('id')
            ->paginate(15);
    }

    /**
     * Role-scoped single fetch — never 404s a record that merely sits past
     * page one of the index.
     */
    public function findScoped(User $user, int $id): ?HealthRecord
    {
        return $this->scopeFor($user)
            ->with(['beneficiary', 'doctor'])
            ->find($id);
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
     * Author a health record. The veterinarian is recorded as its author;
     * eligibility is enforced by StoreHealthRecordRequest.
     */
    public function create(User $doctor, array $data): HealthRecord
    {
        return HealthRecord::create([
            ...$data,
            'doctor_id' => $doctor->id,
        ]);
    }

    public function update(HealthRecord $record, array $data): HealthRecord
    {
        $record->update($data);

        return $record->refresh();
    }

    public function delete(HealthRecord $record): void
    {
        $record->delete();
    }
}
