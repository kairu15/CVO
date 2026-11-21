<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Database\Factories\VaccinationFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One completed vaccination. Administration facts are append-only history;
 * the household's next-due override is the only mutable scheduling layer.
 */
class Vaccination extends Model
{
    /** @use HasFactory<VaccinationFactory> */
    use Auditable, HasFactory, SoftDeletes;

    protected $fillable = [
        'beneficiary_id',
        'technician_id',
        'vaccine_name',
        'administered_on',
        'quantity',
        'batch_number',
        'protocol_days',
        'next_due_on',
        'notes',
    ];

    protected function auditKey(): string
    {
        return 'vaccination';
    }

    protected function casts(): array
    {
        return [
            'administered_on' => 'date:Y-m-d',
            'next_due_on' => 'date:Y-m-d',
            'quantity' => 'integer',
            'protocol_days' => 'integer',
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
