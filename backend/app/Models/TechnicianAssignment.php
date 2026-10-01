<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One row in the technician-assignment audit trail.
 *
 * Append-only in normal use: the ACTIVE assignment lives on
 * beneficiaries.technician_id; this table records every assign/reassign/clear
 * event with who made it and what it replaced, so responsibility can be
 * reconstructed for any date. Rows are never updated, and are only ever
 * SOFT-deleted — together with the household they describe — when a farmer is
 * removed; the history stays in the database for audit.
 *
 * @property int $id
 * @property int $beneficiary_id
 * @property int|null $technician_id
 * @property int $assigned_by
 * @property \Illuminate\Support\Carbon $assigned_at
 * @property int|null $previous_technician_id
 */
class TechnicianAssignment extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'beneficiary_id',
        'technician_id',
        'assigned_by',
        'assigned_at',
        'previous_technician_id',
    ];

    protected function casts(): array
    {
        return [
            'assigned_at' => 'datetime',
        ];
    }

    /** The beneficiary whose technician changed. */
    public function beneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class);
    }

    /** The technician the beneficiary was assigned TO by this event (null = cleared). */
    public function technician(): BelongsTo
    {
        return $this->belongsTo(User::class, 'technician_id');
    }

    /** The admin who made this assignment. */
    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by');
    }
}
