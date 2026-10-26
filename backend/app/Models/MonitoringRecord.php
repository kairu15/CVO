<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class MonitoringRecord extends Model
{
    /** @use HasFactory<\Database\Factories\MonitoringRecordFactory> */
    use Auditable, HasFactory, SoftDeletes;

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
    ];

    /** Audit action prefix: `monitoring_created`, not `monitoring_record_created`. */
    protected function auditKey(): string
    {
        return 'monitoring';
    }

    protected function casts(): array
    {
        return [
            'date_monitored' => 'date',
            'date_vits_supp' => 'date',
            'deworming_date' => 'date',
            'vaccination_date' => 'date',
            'date_breed' => 'date',
            'date_calved' => 'date',
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
}
