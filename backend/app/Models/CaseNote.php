<?php

namespace App\Models;

use Database\Factories\CaseNoteFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A veterinary case about a beneficiary's animal.
 *
 * The original note text remains the case's initial observation. Follow-up
 * activity and status changes live in the append-only `case_note_updates`
 * timeline, so a later entry never rewrites what was observed before it.
 */
class CaseNote extends Model
{
    /** @use HasFactory<CaseNoteFactory> */
    use HasFactory, SoftDeletes;

    public const STATUS_OPEN = 'open';

    public const STATUS_OBSERVATION = 'observation';

    public const STATUS_RESOLVED = 'resolved';

    /** @var list<string> */
    public const STATUSES = [
        self::STATUS_OPEN,
        self::STATUS_OBSERVATION,
        self::STATUS_RESOLVED,
    ];

    /** @var list<string> */
    public const CATEGORIES = [
        'general',
        'illness',
        'injury',
        'reproduction',
        'parasites',
        'mortality',
        'other',
    ];

    protected $fillable = [
        'beneficiary_id',
        'doctor_id',
        'category',
        'status',
        'location',
        'date_noted',
        'body',
        'actions_taken',
        'recommendations',
        'follow_up_on',
        'follow_up_completed_at',
        'health_record_id',
        'field_visit_id',
        'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'date_noted' => 'date:Y-m-d',
            'follow_up_on' => 'date:Y-m-d',
            'follow_up_completed_at' => 'datetime',
            'resolved_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::created(function (CaseNote $note): void {
            if ($note->reference_number) {
                return;
            }

            $year = $note->date_noted?->format('Y') ?? now()->format('Y');

            $note->forceFill([
                'reference_number' => 'CN-'.$year.'-'.str_pad((string) $note->id, 5, '0', STR_PAD_LEFT),
            ])->saveQuietly();
        });
    }

    /**
     * Derived follow-up state, exactly like a health record: the date is the
     * schedule, the completion stamp is the outcome, and overdue is computed
     * against today rather than stored.
     */
    public function followUpStatus(): ?string
    {
        if (! $this->follow_up_on) {
            return null;
        }

        if ($this->follow_up_completed_at) {
            return 'completed';
        }

        return $this->follow_up_on->lt(today()) ? 'overdue' : 'upcoming';
    }

    public function beneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class);
    }

    /** The technician who opened the case. */
    public function doctor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'doctor_id');
    }

    /** Related clinical examination, when this case came from one. */
    public function healthRecord(): BelongsTo
    {
        return $this->belongsTo(HealthRecord::class);
    }

    /** Related field visit, when the case was opened during a trip. */
    public function fieldVisit(): BelongsTo
    {
        return $this->belongsTo(FieldVisit::class);
    }

    /** Append-only chronological activity. */
    public function updates(): HasMany
    {
        return $this->hasMany(CaseNoteUpdate::class)
            ->orderBy('happened_on')
            ->orderBy('id');
    }
}
