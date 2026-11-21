<?php

namespace App\Models;

use Database\Factories\HealthRecordFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A veterinarian's clinical record for a beneficiary's animal.
 *
 * The farmer/animal identity (name_of_farmer, address, animal_type, sex) lives
 * on `Beneficiary` and is joined at read time — never duplicated here.
 */
class HealthRecord extends Model
{
    /** @use HasFactory<HealthRecordFactory> */
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'beneficiary_id',
        'doctor_id',
        'animal_quantity',
        'date_recorded',
        'diagnosis',
        'symptoms',
        'treatment',
        'outcome',
        'follow_up_on',
        'follow_up_completed_at',
        'remarks',
    ];

    protected function casts(): array
    {
        return [
            'animal_quantity' => 'integer',
            'date_recorded' => 'date',
            'follow_up_on' => 'date',
            'follow_up_completed_at' => 'datetime',
        ];
    }

    /**
     * Derived follow-up state: the date is the schedule, the completion stamp
     * is the outcome. Nothing stores "overdue" because tomorrow it would be a
     * lie — it is computed against today on every read.
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

    /**
     * The animal/household this record is about.
     */
    public function beneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class);
    }

    /**
     * The veterinarian who authored the record.
     */
    public function doctor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'doctor_id');
    }
}
