<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One append-only entry in a case's timeline.
 *
 * Entries are never updated or deleted by the application: a correction is a
 * new entry, not a rewrite of the record that came before it.
 */
class CaseNoteUpdate extends Model
{
    protected $fillable = [
        'case_note_id',
        'doctor_id',
        'happened_on',
        'observations',
        'actions_taken',
        'recommendations',
        'status',
        'follow_up_on',
        'health_record_id',
        'field_visit_id',
    ];

    protected function casts(): array
    {
        return [
            'happened_on' => 'date:Y-m-d',
            'follow_up_on' => 'date:Y-m-d',
        ];
    }

    public function caseNote(): BelongsTo
    {
        return $this->belongsTo(CaseNote::class);
    }

    /** The technician who recorded this update. */
    public function doctor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'doctor_id');
    }

    public function healthRecord(): BelongsTo
    {
        return $this->belongsTo(HealthRecord::class);
    }

    public function fieldVisit(): BelongsTo
    {
        return $this->belongsTo(FieldVisit::class);
    }
}
