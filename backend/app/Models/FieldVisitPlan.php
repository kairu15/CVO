<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A planned field visit, separate from the completed FieldVisit log.
 *
 * The plan carries the schedule and status; the FieldVisit carries the
 * evidence. Completing a plan links the two by `field_visit_id`.
 */
class FieldVisitPlan extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_IN_PROGRESS = 'in_progress';

    public const STATUS_COMPLETED = 'completed';

    /** Statuses that still represent work to do. */
    public const OPEN_STATUSES = [self::STATUS_PENDING, self::STATUS_IN_PROGRESS];

    protected $fillable = [
        'beneficiary_id',
        'technician_id',
        'planned_for',
        'purpose',
        'status',
        'notes',
        'field_visit_id',
        'completed_at',
    ];

    protected function casts(): array
    {
        return [
            'planned_for' => 'date',
            'completed_at' => 'datetime',
        ];
    }

    public function beneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class);
    }

    public function technician(): BelongsTo
    {
        return $this->belongsTo(User::class, 'technician_id');
    }

    public function fieldVisit(): BelongsTo
    {
        return $this->belongsTo(FieldVisit::class);
    }

    public function scopeOpen(Builder $query): Builder
    {
        return $query->whereIn('status', self::OPEN_STATUSES);
    }

    public function isOverdue(): bool
    {
        return $this->status !== self::STATUS_COMPLETED
            && $this->planned_for->lt(today());
    }
}
