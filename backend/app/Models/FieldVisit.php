<?php

namespace App\Models;

use Database\Factories\FieldVisitFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A technician's trip to a beneficiary's farm.
 *
 * The trip, not the animal's condition — visit-specific observations such as
 * body condition score belong on a MonitoringRecord. See the field_visits
 * migration for the boundary.
 */
class FieldVisit extends Model
{
    /** @use HasFactory<FieldVisitFactory> */
    use HasFactory;

    protected $fillable = [
        'beneficiary_id',
        'technician_id',
        'visited_on',
        'purpose',
        'latitude',
        'longitude',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'visited_on' => 'date',
            'latitude' => 'float',
            'longitude' => 'float',
        ];
    }

    /**
     * The household/animal that was visited.
     */
    public function beneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class);
    }

    /**
     * The technician who made the trip.
     */
    public function technician(): BelongsTo
    {
        return $this->belongsTo(User::class, 'technician_id');
    }

    /**
     * Whether a GPS fix was captured on site.
     */
    public function hasLocation(): bool
    {
        return $this->latitude !== null && $this->longitude !== null;
    }
}
