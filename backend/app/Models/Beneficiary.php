<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Beneficiary extends Model
{
    /** @use HasFactory<\Database\Factories\BeneficiaryFactory> */
    use HasFactory;

    protected $fillable = [
        'farmer_id',
        'name_of_farmer',
        'address',
        'animal_type',
        'sex',
        'technician_id',
    ];

    /**
     * The farmer user account that owns this dispersed animal.
     */
    public function farmer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'farmer_id');
    }

    /**
     * The technician currently assigned to monitor this beneficiary.
     */
    public function technician(): BelongsTo
    {
        return $this->belongsTo(User::class, 'technician_id');
    }

    public function monitoringRecords(): HasMany
    {
        return $this->hasMany(MonitoringRecord::class);
    }
}
