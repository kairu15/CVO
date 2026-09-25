<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

/**
 * One geotagged field-visit photo: the composited image URL plus every
 * structured metadata field from the capture moment (the same fields burned
 * into the pixels, stored queryably).
 *
 * @property mixed $resource
 */
class FieldVisitPhotoResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'field_visit_id' => $this->field_visit_id,
            'technician_id' => $this->technician_id,

            'image_url' => Storage::disk('public')->url($this->image_path),

            // Wall-clock fields (device-local, as captured).
            'capture_date' => $this->capture_date?->toDateString(),
            'capture_time' => $this->capture_time,
            'timezone_offset' => $this->timezone_offset,
            'capture_year' => $this->capture_year,
            'capture_month' => $this->capture_month,
            'capture_day' => $this->capture_day,
            'capture_hour' => $this->capture_hour,
            'capture_minute' => $this->capture_minute,
            'capture_second' => $this->capture_second,
            'capture_millisecond' => $this->capture_millisecond,

            // The GPS fix.
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            'accuracy_m' => $this->accuracy_m,
            'altitude_m' => $this->altitude_m,
            'speed_kmh' => $this->speed_kmh,
            'heading_deg' => $this->heading_deg,
            'location_source' => $this->location_source,
            'address' => $this->address,

            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
