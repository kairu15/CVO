<?php

namespace App\Models;

use Database\Factories\HealthRecordFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A veterinarian's clinical record for a beneficiary's animal.
 *
 * The farmer/animal identity (name_of_farmer, address, animal_type, sex) lives
 * on `Beneficiary` and is joined at read time — never duplicated here.
 */
class HealthRecord extends Model
{
    /** @use HasFactory<HealthRecordFactory> */
    use HasFactory;

    protected $fillable = [
        'beneficiary_id',
        'doctor_id',
        'date_recorded',
        'diagnosis',
        'treatment',
        'outcome',
        'remarks',
    ];

    protected function casts(): array
    {
        return [
            'date_recorded' => 'date',
        ];
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
