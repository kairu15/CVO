<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Purok extends Model
{
    protected $fillable = ['barangay_id', 'name', 'latitude', 'longitude', 'is_placeholder'];

    protected function casts(): array
    {
        return [
            'is_placeholder' => 'boolean',
        ];
    }

    /**
     * The barangay this purok/sitio belongs to.
     */
    public function barangay(): BelongsTo
    {
        return $this->belongsTo(Barangay::class);
    }

    /**
     * Beneficiary households located in this purok.
     */
    public function beneficiaries(): HasMany
    {
        return $this->hasMany(Beneficiary::class);
    }
}
