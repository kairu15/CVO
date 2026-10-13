<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Barangay extends Model
{
    protected $fillable = ['name', 'latitude', 'longitude'];

    public function puroks(): HasMany
    {
        return $this->hasMany(Purok::class);
    }
}
