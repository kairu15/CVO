<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MonitoringRecord extends Model
{
    /** @use HasFactory<\Database\Factories\MonitoringRecordFactory> */
    use HasFactory;

    /** Registration lifecycle states (see the 2026_09_26 migration). */
    public const REGISTRATION_NONE = 'none';
    public const REGISTRATION_NEW = 'new';
    public const REGISTRATION_ACCEPTED = 'accepted';
    public const REGISTRATION_OLD = 'old';

    protected $fillable = [
        'beneficiary_id',
        'technician_id',
        'date_monitored',
        'date_vits_supp',
        'deworming_date',
        'vaccination_date',
        'date_breed',
        'date_calved',
        'bcs',
        'farmers_signature',
        'remarks',
        'registration_status',
        'registered_at',
        'accepted_at',
        'status_expires_at',
    ];

    protected function casts(): array
    {
        return [
            'date_monitored' => 'date',
            'date_vits_supp' => 'date',
            'deworming_date' => 'date',
            'vaccination_date' => 'date',
            'date_breed' => 'date',
            'date_calved' => 'date',
            'registered_at' => 'datetime',
            'accepted_at' => 'datetime',
            'status_expires_at' => 'datetime',
        ];
    }

    /**
     * Whether the row should currently render as "New" — freshly registered,
     * or accepted with its midnight countdown still running.
     */
    public function isNewRegistration(): bool
    {
        if (! in_array($this->registration_status, [self::REGISTRATION_NEW, self::REGISTRATION_ACCEPTED], true)) {
            return false;
        }

        return $this->status_expires_at === null || $this->status_expires_at->isFuture();
    }

    public function beneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class);
    }

    public function technician(): BelongsTo
    {
        return $this->belongsTo(User::class, 'technician_id');
    }
}
