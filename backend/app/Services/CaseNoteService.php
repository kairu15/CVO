<?php

namespace App\Services;

use App\Models\CaseNote;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class CaseNoteService
{
    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
        private readonly AuditLogger $audit,
    ) {}

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
        $note = CaseNote::create([
            ...$data,
            'doctor_id' => $doctor->id,
        ]);

        $this->audit->log($doctor, 'case_note_created', $note);

        return $note;
    }

    public function update(User $actor, CaseNote $note, array $data): CaseNote
    {
        $note->update($data);

        $this->audit->log($actor, 'case_note_updated', $note);

        return $note->refresh();
    }

    public function delete(User $actor, CaseNote $note): void
    {
        $note->delete();

        $this->audit->log($actor, 'case_note_deleted', $note);
    }
}
