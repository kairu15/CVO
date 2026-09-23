<?php

namespace App\Models;

use Database\Factories\CaseNoteFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A dated, freeform veterinary note about a beneficiary's animal.
 *
 * Not a diagnosis — that is a HealthRecord. See the case_notes migration for
 * the boundary between the two, which is what stops an animal's history being
 * split across two screens.
 */
class CaseNote extends Model
{
    /** @use HasFactory<CaseNoteFactory> */
    use HasFactory;

    protected $fillable = [
        'beneficiary_id',
        'doctor_id',
        'date_noted',
        'body',
    ];

    protected function casts(): array
    {
        return [
            'date_noted' => 'date',
        ];
    }

    /**
     * The animal/household this note is about.
     */
    public function beneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class);
    }

    /**
     * The veterinarian who wrote the note.
     */
    public function doctor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'doctor_id');
    }
}
