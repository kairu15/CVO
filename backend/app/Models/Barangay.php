<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Barangay extends Model
{
    protected $fillable = ['name', 'latitude', 'longitude', 'population'];

    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
            'population' => 'integer',
        ];
    }

    public function puroks(): HasMany
    {
        return $this->hasMany(Purok::class);
    }
}
