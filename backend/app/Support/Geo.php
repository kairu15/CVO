<?php

namespace App\Support;

use App\Models\Barangay;
use App\Models\Purok;
use Illuminate\Support\Facades\DB;

/**
 * Geo helpers for barangay/purok auto-detection from GPS or a map pin.
 *
 * HOW MATCHING WORKS (and its limits)
 * -----------------------------------
 * The program has barangay *center points*, not boundary polygons, so
 * "which barangay is this coordinate in?" is answered by NEAREST-CENTROID
 * matching, not true point-in-polygon containment. That is an approximation:
 * for large or irregularly shaped barangays a coordinate near a border can
 * match the neighbouring barangay's center instead of the true one. Treat
 * every result from this class as a SUGGESTION to be confirmed by the
 * farmer — never as authoritative containment — and, when boundary
 * GeoJSON becomes available, replace the haversine ordering here with a
 * real spatial containment query.
 *
 * Implementation note: the search narrows with a lat/lng bounding box in
 * SQL (indexed, portable) and orders by haversine in PHP over the few
 * remaining candidates. A pure-SQL haversine was rejected deliberately —
 * SQLite (the test database) ships without trig functions, so the SQL
 * would pass on MySQL and crash the suite. 28 barangays keep the PHP side
 * trivial; the box keeps it correct if the table ever grows.
 */
class Geo
{
    /** Earth's mean radius in kilometres (haversine sphere model). */
    private const EARTH_RADIUS_KM = 6371.0088;

    /**
     * The barangay whose stored center is closest to the coordinate,
     * or null when no covered barangay center lies within the radius.
     *
     * @return array{id: int, name: string, latitude: float, longitude: float, distance_km: float}|null
     */
    public static function nearestBarangay(float $latitude, float $longitude, float $radiusKm = 15): ?array
    {
        return self::nearestWithin(
            Barangay::query(),
            $latitude,
            $longitude,
            $radiusKm,
            fn (Barangay $row): array => [
                'id' => $row->id,
                'name' => $row->name,
                'latitude' => (float) $row->latitude,
                'longitude' => (float) $row->longitude,
            ],
        );
    }

    /**
     * The closest purok center within ONE barangay (the second step of the
     * cascade — a pin inside a barangay must never suggest a purok from a
     * neighbouring one), or null when that barangay has no purok centers.
     *
     * @return array{id: int, name: string, latitude: float, longitude: float, distance_km: float}|null
     */
    public static function nearestPurok(float $latitude, float $longitude, int $barangayId, float $radiusKm = 10): ?array
    {
        return self::nearestWithin(
            Purok::query()->where('barangay_id', $barangayId),
            $latitude,
            $longitude,
            $radiusKm,
            fn (Purok $row): array => [
                'id' => $row->id,
                'name' => $row->name,
                'latitude' => (float) $row->latitude,
                'longitude' => (float) $row->longitude,
            ],
        );
    }

    /**
     * Great-circle distance in kilometres (haversine formula).
     */
    public static function haversineKm(float $latFrom, float $lngFrom, float $latTo, float $lngTo): float
    {
        $latFromRad = deg2rad($latFrom);
        $latToRad = deg2rad($latTo);
        $dLat = deg2rad($latTo - $latFrom);
        $dLng = deg2rad($lngTo - $lngFrom);

        $a = sin($dLat / 2) ** 2
            + cos($latFromRad) * cos($latToRad) * sin($dLng / 2) ** 2;

        return 2 * self::EARTH_RADIUS_KM * asin(min(1.0, sqrt($a)));
    }

    /**
     * Shared pipeline: bounding-box filter in SQL, haversine ranking in PHP.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  \Illuminate\Database\Eloquent\Builder<TModel>  $query
     * @param  callable(TModel): array{id: int, name: string, latitude: float, longitude: float}  $map
     * @return array{id: int, name: string, latitude: float, longitude: float, distance_km: float}|null
     */
    private static function nearestWithin($query, float $latitude, float $longitude, float $radiusKm, callable $map): ?array
    {
        // Bounding box: 1° latitude ≈ 110.574 km; longitude shrinks with
        // cos(latitude) and can never exceed the equator value here, so this
        // box always contains the true radius. Nearest-centroid matching is
        // approximate by design — see the class docblock.
        $latSpan = $radiusKm / 110.574;
        $lngSpan = $radiusKm / max(1.0, 111.320 * cos(deg2rad($latitude)));

        $candidates = (clone $query)
            ->whereBetween('latitude', [$latitude - $latSpan, $latitude + $latSpan])
            ->whereBetween('longitude', [$longitude - $lngSpan, $longitude + $lngSpan])
            ->get();

        $best = null;
        $bestKm = null;

        foreach ($candidates as $row) {
            $distance = self::haversineKm($latitude, $longitude, (float) $row->latitude, (float) $row->longitude);

            if ($bestKm === null || $distance < $bestKm) {
                $bestKm = $distance;
                $best = $map($row);
            }
        }

        if ($best === null || $bestKm > $radiusKm) {
            return null;
        }

        return [...$best, 'distance_km' => round($bestKm, 3)];
    }
}
