<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A geotagged photo captured on a field visit.
 *
 * The image on disk has the metadata panel burned into the pixels (the
 * technician's evidence of where/when), but the truth lives here: every
 * field from the capture moment is a real, queryable column. Rows are
 * immutable — a retake deletes and recreates, never edits.
 *
 * @property int $id
 * @property int $field_visit_id
 * @property int $technician_id
 * @property string $image_path
 * @property string $capture_date
 * @property string $capture_time
 * @property string $timezone_offset
 * @property int $capture_year
 * @property int $capture_month
 * @property int $capture_day
 * @property int $capture_hour
 * @property int $capture_minute
 * @property int $capture_second
 * @property int|null $capture_millisecond
 * @property float|null $latitude
 * @property float|null $longitude
 * @property float|null $accuracy_m
 * @property float|null $altitude_m
 * @property float|null $speed_kmh
 * @property int|null $heading_deg
 * @property string|null $location_source
 * @property string|null $address
 */
class FieldVisitPhoto extends Model
{
    protected $fillable = [
        'field_visit_id',
        'technician_id',
        'image_path',
        'capture_date',
        'capture_time',
        'timezone_offset',
        'capture_year',
        'capture_month',
        'capture_day',
        'capture_hour',
        'capture_second',
        'capture_minute',
        'capture_millisecond',
        'latitude',
        'longitude',
        'accuracy_m',
        'altitude_m',
        'speed_kmh',
        'heading_deg',
        'location_source',
        'address',
    ];

    protected function casts(): array
    {
        return [
            'capture_date' => 'date',
            'latitude' => 'float',
            'longitude' => 'float',
            'accuracy_m' => 'float',
            'altitude_m' => 'float',
            'speed_kmh' => 'float',
            'heading_deg' => 'integer',
        ];
    }

    public function fieldVisit(): BelongsTo
    {
        return $this->belongsTo(FieldVisit::class);
    }

    public function technician(): BelongsTo
    {
        return $this->belongsTo(User::class, 'technician_id');
    }
}
