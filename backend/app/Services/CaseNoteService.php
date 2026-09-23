<?php

namespace App\Services;

use App\Models\CaseNote;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class CaseNoteService
{
    public function __construct(private readonly BeneficiaryService $beneficiaries) {}

    /**
     * Role-scoped notes, newest first.
     *
     * Scoping rides on the beneficiary scoping — the same rule monitoring and
     * health records use — so a technician only receives notes for assigned
     * beneficiaries and a farmer only their own, server-side.
     */
    public function listFor(User $user): LengthAwarePaginator
    {
        return $this->scopeFor($user)
            ->with(['beneficiary', 'doctor'])
            ->latest('date_noted')
            ->latest('id')
            ->paginate(15);
    }

    /**
     * Role-scoped single fetch — never 404s a note that merely sits past page
     * one of the index.
     */
    public function findScoped(User $user, int $id): ?CaseNote
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

        return CaseNote::query()->whereIn('beneficiary_id', $beneficiaryIds);
    }

    /**
     * Write a note. The veterinarian is recorded as its author; eligibility is
     * enforced by StoreCaseNoteRequest.
     */
    public function create(User $doctor, array $data): CaseNote
    {
        return CaseNote::create([
            ...$data,
            'doctor_id' => $doctor->id,
        ]);
    }

    public function update(CaseNote $note, array $data): CaseNote
    {
        $note->update($data);

        return $note->refresh();
    }

    public function delete(CaseNote $note): void
    {
        $note->delete();
    }
}
