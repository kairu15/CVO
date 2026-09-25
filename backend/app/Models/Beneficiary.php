<?php

namespace App\Models;

use Database\Factories\BeneficiaryFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Beneficiary extends Model
{
    /** @use HasFactory<BeneficiaryFactory> */
    use HasFactory;

    protected $fillable = [
        'farmer_id',
        'name_of_farmer',
        'address',
        'barangay_id',
        'purok_id',
        'animal_type',
        'sex',
        'technician_id',
        'latitude',
        'longitude',
        'location_source',
    ];

    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
            'barangay_id' => 'integer',
            'purok_id' => 'integer',
        ];
    }

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

    /**
     * The barangay this household sits in — the structured twin of the
     * free-text `address` string (which stays the synced display value).
     */
    public function barangay(): BelongsTo
    {
        return $this->belongsTo(Barangay::class);
    }

    /**
     * The purok/sitio within the barangay — the finest location grain the
     * program tracks, and what dispersal geo-tagging resolves against.
     */
    public function purok(): BelongsTo
    {
        return $this->belongsTo(Purok::class);
    }

    public function monitoringRecords(): HasMany
    {
        return $this->hasMany(MonitoringRecord::class);
    }

    /**
     * Dispersal events that delivered an animal to this beneficiary.
     */
    public function dispersalEvents(): HasMany
    {
        return $this->hasMany(DispersalEvent::class);
    }

    /**
     * Clinical health records for this beneficiary's animal.
     */
    public function healthRecords(): HasMany
    {
        return $this->hasMany(HealthRecord::class);
    }

    /**
     * Freeform veterinary notes about this beneficiary's animal.
     */
    public function caseNotes(): HasMany
    {
        return $this->hasMany(CaseNote::class);
    }
}
