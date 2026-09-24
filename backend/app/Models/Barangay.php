<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Barangay extends Model
{
    protected $fillable = ['name', 'latitude', 'longitude'];

    /**
     * The puroks/sitios inside this barangay.
     */
    public function puroks(): HasMany
    {
        return $this->hasMany(Purok::class);
    }
}
