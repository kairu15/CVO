<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\CaseNote;
use App\Models\CaseNoteUpdate;
use App\Models\FieldVisit;
use App\Models\HealthRecord;
use App\Models\User;
use App\Support\Barangays;
use App\Support\ImageSanitizer;
use App\Support\Pagination;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

class CaseNoteService
{
    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Role-scoped, filtered case records. Every filter runs before pagination
     * so a page never represents a client-side slice of a larger result.
     *
     * @param  array<string, mixed>  $filters
     */
    public function listFor(
        User $user,
        array $filters = [],
        int $perPage = Pagination::DEFAULT_PER_PAGE,
    ): LengthAwarePaginator {
        $query = $this->scopeFor($user)
            ->with(['beneficiary', 'doctor'])
            ->withCount('updates');

        $this->applyFilters($query, $filters);
        $this->applySort($query, $filters);

        return $query->paginate($perPage)->withQueryString();
    }

    /**
     * The four case status figures plus the follow-up worklist counters.
     *
     * @return array<string, int>
     */
    public function summaryFor(User $user): array
    {
        $base = fn (): Builder => $this->scopeFor($user);

        $pending = fn (): Builder => $base()
            ->whereNotNull('follow_up_on')
            ->whereNull('follow_up_completed_at');

        return [
            'total_cases' => $base()->count(),
            'open_cases' => $base()->where('status', CaseNote::STATUS_OPEN)->count(),
            'observation_cases' => $base()->where('status', CaseNote::STATUS_OBSERVATION)->count(),
            'resolved_cases' => $base()->where('status', CaseNote::STATUS_RESOLVED)->count(),
            'follow_up_upcoming' => $pending()
                ->whereDate('follow_up_on', '>=', today()->toDateString())
                ->count(),
            'follow_up_overdue' => $pending()
                ->whereDate('follow_up_on', '<', today()->toDateString())
                ->count(),
            'follow_up_completed' => $base()
                ->whereNotNull('follow_up_completed_at')
                ->count(),
        ];
    }

    /**
     * The vocabulary the create/edit forms and update modal share.
     *
     * @return array<string, mixed>
     */
    public function optionsFor(User $user): array
    {
        abort_unless($user->hasPermission('case_notes.view'), 403);

        return [
            'categories' => CaseNote::CATEGORIES,
            'statuses' => CaseNote::STATUSES,
            'follow_up_statuses' => ['upcoming', 'overdue', 'completed'],
        ];
    }

    /**
     * Role-scoped single fetch. Detail responses eagerly load the timeline,
     * linked records and the household's existing clinical/visit history.
     */
    public function findScoped(User $user, int $id, bool $detail = false): ?CaseNote
    {
        $query = $this->scopeFor($user)
            ->with(['beneficiary', 'doctor', 'healthRecord', 'fieldVisit']);

        if ($detail) {
            $query->with([
                'updates.doctor',
                'updates.healthRecord',
                'updates.fieldVisit',
                'beneficiary' => fn ($beneficiary) => $beneficiary->with([
                    'healthRecords' => fn ($records) => $records
                        ->with('doctor')
                        ->orderByDesc('date_recorded')
                        ->limit(20),
                    'fieldVisits' => fn ($visits) => $visits
                        ->with('technician')
                        ->orderByDesc('visited_on')
                        ->limit(20),
                ]),
            ]);
        }

        return $query->find($id);
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
     * Write the case. The technician is recorded as its author (`doctor_id` —
     * the attending veterinarian, a schema name); eligibility is enforced by
     * StoreCaseNoteRequest.
     */
    public function create(User $author, array $data): CaseNote
    {
        $this->assertLinksBelong((int) $data['beneficiary_id'], $data);

        $beneficiary = $this->beneficiaries->findFor($author, (int) $data['beneficiary_id']);

        $note = CaseNote::create([
            ...$data,
            'category' => $data['category'] ?? CaseNote::CATEGORIES[0],
            'status' => $data['status'] ?? CaseNote::STATUS_OPEN,
            'resolved_at' => ($data['status'] ?? null) === CaseNote::STATUS_RESOLVED ? now() : null,
            'location' => ($data['location'] ?? null) ?: $beneficiary->address,
            'doctor_id' => $author->id,
        ]);

        $this->audit->log($author, 'case_note_created', $note);

        return $note;
    }

    /**
     * Revise case details. Timeline entries are not touched; a status or
     * follow-up completion change appends its own timeline row so the change
     * is visible in the case history rather than only in the audit log.
     */
    public function update(User $actor, CaseNote $note, array $data): CaseNote
    {
        $this->assertLinksBelong($note->beneficiary_id, $data);

        $completed = array_key_exists('follow_up_completed', $data)
            ? (bool) $data['follow_up_completed']
            : null;
        unset($data['follow_up_completed']);

        $oldStatus = $note->status;
        $oldCompleted = $note->follow_up_completed_at !== null;
        $statusChanged = array_key_exists('status', $data) && $data['status'] !== $oldStatus;

        if ($statusChanged) {
            $data['resolved_at'] = $data['status'] === CaseNote::STATUS_RESOLVED ? now() : null;
        }

        if (array_key_exists('follow_up_on', $data) && $data['follow_up_on'] === null) {
            $data['follow_up_completed_at'] = null;
        }

        if ($completed === true) {
            $data['follow_up_completed_at'] = $note->follow_up_completed_at ?? now();
        } elseif ($completed === false) {
            $data['follow_up_completed_at'] = null;
        }

        DB::transaction(function () use ($note, $data, $actor, $statusChanged, $oldStatus, $completed, $oldCompleted): void {
            $note->update($data);

            if ($statusChanged) {
                $this->appendTimeline($note, $actor, [
                    'happened_on' => today()->toDateString(),
                    'observations' => 'Status changed from '.$this->statusLabel($oldStatus).' to '.$this->statusLabel($note->status).'.',
                    'status' => $note->status,
                ]);
            } elseif ($completed !== null && $completed !== $oldCompleted) {
                $this->appendTimeline($note, $actor, [
                    'happened_on' => today()->toDateString(),
                    'observations' => $completed ? 'Follow-up marked complete.' : 'Follow-up reopened.',
                ]);
            }
        });

        $this->audit->log($actor, 'case_note_updated', $note);

        return $note->refresh();
    }

    /**
     * Append a follow-up / progress entry and apply any case-level changes it
     * carries (status, next follow-up date, completion).
     */
    public function addUpdate(User $actor, CaseNote $note, array $data): CaseNoteUpdate
    {
        $this->assertLinksBelong($note->beneficiary_id, $data);

        $completed = array_key_exists('follow_up_completed', $data)
            ? (bool) $data['follow_up_completed']
            : null;
        unset($data['follow_up_completed']);

        $update = DB::transaction(function () use ($note, $actor, $data, $completed): CaseNoteUpdate {
            $timeline = $this->appendTimeline($note, $actor, $data);

            $caseChanges = [];

            if (array_key_exists('status', $data) && $data['status'] !== null) {
                $caseChanges['status'] = $data['status'];
                $caseChanges['resolved_at'] = $data['status'] === CaseNote::STATUS_RESOLVED ? now() : null;
            }

            if (array_key_exists('follow_up_on', $data)) {
                $caseChanges['follow_up_on'] = $data['follow_up_on'];
            }

            if ($completed === true) {
                $caseChanges['follow_up_on'] = $data['follow_up_on']
                    ?? $note->follow_up_on?->toDateString()
                    ?? today()->toDateString();
                $caseChanges['follow_up_completed_at'] = now();
            } elseif ($completed === false) {
                $caseChanges['follow_up_completed_at'] = null;
            }

            if ($caseChanges !== []) {
                $note->update($caseChanges);
            }

            return $timeline;
        });

        $this->audit->log($actor, 'case_note_update_added', $note, [
            'update_id' => $update->id,
        ]);

        return $update->load(['doctor', 'healthRecord', 'fieldVisit']);
    }

    /**
     * Attach one supporting case photo on the private disk. A retake replaces
     * the previous file, exactly like a health record's supporting image.
     */
    public function attachPhoto(User $actor, CaseNote $note, UploadedFile $file): CaseNote
    {
        $sanitized = ImageSanitizer::sanitizeToUpload($file);
        $path = ImageSanitizer::storeImage($sanitized, "case-notes/{$note->id}");

        if ($note->photo_path) {
            Storage::disk('secure')->delete($note->photo_path);
        }

        $note->forceFill(['photo_path' => $path])->save();

        $this->audit->log($actor, 'case_note_photo_uploaded', $note);

        return $note->refresh();
    }

    public function delete(User $actor, CaseNote $note): void
    {
        $note->delete();

        $this->audit->log($actor, 'case_note_deleted', $note);
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    protected function applyFilters(Builder $query, array $filters): void
    {
        $search = trim((string) ($filters['search'] ?? ''));
        $status = (string) ($filters['status'] ?? '');
        $category = (string) ($filters['category'] ?? '');
        $barangay = trim((string) ($filters['barangay'] ?? ''));
        $followUp = (string) ($filters['follow_up'] ?? '');

        $query
            ->when($search !== '', function (Builder $query) use ($search): void {
                $pattern = "%{$search}%";

                $query->where(function (Builder $group) use ($pattern): void {
                    $group->whereLike('reference_number', $pattern)
                        ->orWhereLike('body', $pattern)
                        ->orWhereLike('location', $pattern)
                        ->orWhereLike('actions_taken', $pattern)
                        ->orWhereLike('recommendations', $pattern)
                        ->orWhereLike('category', $pattern)
                        ->orWhereHas('beneficiary', function (Builder $household) use ($pattern): void {
                            $household->whereLike('name_of_farmer', $pattern)
                                ->orWhereLike('rsbsa_number', $pattern)
                                ->orWhereLike('ear_tag_number', $pattern)
                                ->orWhereLike('animal_type', $pattern)
                                ->orWhereLike('address', $pattern);
                        });
                });
            })
            ->when($status !== '', fn (Builder $query) => $query->where('status', $status))
            ->when($category !== '', fn (Builder $query) => $query->where('category', $category))
            ->when($barangay !== '', fn (Builder $query) => $query->whereHas(
                'beneficiary',
                fn (Builder $household) => $household->where('address', Barangays::normalize($barangay)),
            ))
            ->when($followUp === 'upcoming', fn (Builder $query) => $query
                ->whereNotNull('follow_up_on')
                ->whereNull('follow_up_completed_at')
                ->whereDate('follow_up_on', '>=', today()->toDateString()))
            ->when($followUp === 'overdue', fn (Builder $query) => $query
                ->whereNotNull('follow_up_on')
                ->whereNull('follow_up_completed_at')
                ->whereDate('follow_up_on', '<', today()->toDateString()))
            ->when($followUp === 'completed', fn (Builder $query) => $query
                ->whereNotNull('follow_up_completed_at'));
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    protected function applySort(Builder $query, array $filters): void
    {
        $sort = (string) ($filters['sort'] ?? 'date');
        $direction = ($filters['direction'] ?? 'desc') === 'asc' ? 'asc' : 'desc';

        match ($sort) {
            'farmer' => $query->orderBy(
                Beneficiary::query()
                    ->select('name_of_farmer')
                    ->whereColumn('beneficiaries.id', 'case_notes.beneficiary_id'),
                $direction,
            ),
            'status' => $query->orderBy('status', $direction),
            'reference' => $query->orderBy('reference_number', $direction),
            default => $query->orderBy('date_noted', $direction),
        };

        $query->orderBy('id', $direction);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function appendTimeline(CaseNote $note, User $actor, array $data): CaseNoteUpdate
    {
        return $note->updates()->create([
            'doctor_id' => $actor->id,
            'happened_on' => $data['happened_on'] ?? today()->toDateString(),
            'observations' => $data['observations'] ?? null,
            'actions_taken' => $data['actions_taken'] ?? null,
            'recommendations' => $data['recommendations'] ?? null,
            'status' => $data['status'] ?? null,
            'follow_up_on' => $data['follow_up_on'] ?? null,
            'health_record_id' => $data['health_record_id'] ?? null,
            'field_visit_id' => $data['field_visit_id'] ?? null,
        ]);
    }

    /**
     * A linked record must belong to the same animal. Without this, a client
     * could paste another household's examination id into the case.
     *
     * @param  array<string, mixed>  $data
     */
    private function assertLinksBelong(int $beneficiaryId, array $data): void
    {
        if (($data['health_record_id'] ?? null) !== null
            && ! HealthRecord::query()
                ->whereKey($data['health_record_id'])
                ->where('beneficiary_id', $beneficiaryId)
                ->exists()) {
            throw ValidationException::withMessages([
                'health_record_id' => 'That health record does not belong to this household.',
            ]);
        }

        if (($data['field_visit_id'] ?? null) !== null
            && ! FieldVisit::query()
                ->whereKey($data['field_visit_id'])
                ->where('beneficiary_id', $beneficiaryId)
                ->exists()) {
            throw ValidationException::withMessages([
                'field_visit_id' => 'That field visit does not belong to this household.',
            ]);
        }
    }

    private function statusLabel(string $status): string
    {
        return str_replace('_', ' ', ucfirst($status));
    }
}
