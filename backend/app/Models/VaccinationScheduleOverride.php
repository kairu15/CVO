<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The one effective next-due date for a household's current vaccination
 * cycle. It lets a technician reschedule without rewriting an administration
 * row; the audit trail keeps the old value.
 */
class VaccinationScheduleOverride extends Model
{
    protected $fillable = [
        'beneficiary_id',
        'next_due_on',
        'reason',
        'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'next_due_on' => 'date:Y-m-d',
        ];
    }

    public function beneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class);
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
