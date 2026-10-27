<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * On-site visit verification (Feature 1).
 *
 * Stores, ON THE VISIT, the server's own verdict about whether the captured
 * GPS fix was actually taken at the beneficiary's registered pin:
 *
 *   distance_m             metres between the fix and the registered pin
 *   gps_accuracy_m         the fix's accuracy radius (from the photo capture)
 *   verification_status    on_site | off_site | low_accuracy |
 *                          no_reference_location | no_gps
 *   verification_note      the technician's short justification for an
 *                          off-site visit ("met at alternate site")
 *
 * The values are always written by the SERVER from stored coordinates —
 * a device-computed figure from the offline queue is never trusted. The
 * threshold lives in Settings (`onsite_threshold_m`), so the backfill below
 * uses the SHIPPED default from config; re-running `visits:recompute-verification`
 * (or saving the visit again) re-evaluates every row against the live
 * threshold.
 *
 * No backfill writes a guess: a visit with no fix stays NULL/no_gps, a
 * visit whose beneficiary has no pin stays no_reference_location.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('field_visits', function (Blueprint $table): void {
            $table->unsignedInteger('distance_m')->nullable()->after('longitude');
            $table->decimal('gps_accuracy_m', 8, 2)->nullable()->after('distance_m');
            $table->string('verification_status', 30)->nullable()->after('gps_accuracy_m');
            $table->text('verification_note')->nullable()->after('verification_status');
            $table->timestamp('verification_note_at')->nullable()->after('verification_note');

            // The review filter ("Off-site / needs review") scans by status.
            $table->index('verification_status', 'field_visits_verification_status_index');
        });

        $this->backfill();
    }

    public function down(): void
    {
        Schema::table('field_visits', function (Blueprint $table): void {
            $table->dropIndex('field_visits_verification_status_index');
            $table->dropColumn([
                'distance_m',
                'gps_accuracy_m',
                'verification_status',
                'verification_note',
                'verification_note_at',
            ]);
        });
    }

    /**
     * Evaluate every existing visit against the shipped threshold, using the
     * same precedence the runtime service applies (fix first, then reference,
     * then accuracy, then distance). Written as plain DB queries so the
     * migration does not depend on application classes that may change later.
     */
    private function backfill(): void
    {
        $threshold = max(1, (int) config('cvo.verification.onsite_threshold_m', 100));

        $visits = DB::table('field_visits')
            ->leftJoin('beneficiaries', 'beneficiaries.id', '=', 'field_visits.beneficiary_id')
            ->select([
                'field_visits.id',
                'field_visits.latitude',
                'field_visits.longitude',
                'beneficiaries.latitude as ref_lat',
                'beneficiaries.longitude as ref_lng',
            ])
            ->get();

        if ($visits->isEmpty()) {
            return;
        }

        // The newest photo per visit carries the capture fix + accuracy.
        $photos = [];
        $rows = DB::table('field_visit_photos')
            ->whereIn('field_visit_id', $visits->pluck('id'))
            ->orderByDesc('id')
            ->get(['field_visit_id', 'latitude', 'longitude', 'accuracy_m']);

        foreach ($rows as $row) {
            $photos[$row->field_visit_id] ??= $row;
        }

        foreach ($visits as $visit) {
            $photo = $photos[$visit->id] ?? null;

            $fixLat = $photo?->latitude ?? $visit->latitude;
            $fixLng = $photo?->longitude ?? $visit->longitude;
            $accuracy = $photo?->accuracy_m ?? null;

            $distance = $this->haversine(
                $fixLat !== null ? (float) $fixLat : null,
                $fixLng !== null ? (float) $fixLng : null,
                $visit->ref_lat !== null ? (float) $visit->ref_lat : null,
                $visit->ref_lng !== null ? (float) $visit->ref_lng : null,
            );

            $status = match (true) {
                $fixLat === null || $fixLng === null => 'no_gps',
                $visit->ref_lat === null || $visit->ref_lng === null => 'no_reference_location',
                $accuracy !== null && (float) $accuracy > $threshold => 'low_accuracy',
                $distance !== null && $distance <= $threshold => 'on_site',
                default => 'off_site',
            };

            DB::table('field_visits')->where('id', $visit->id)->update([
                'distance_m' => $distance,
                'gps_accuracy_m' => $accuracy,
                'verification_status' => $status,
            ]);
        }
    }

    /** Metres between two fixes, or null when either end is missing. */
    private function haversine(?float $lat1, ?float $lng1, ?float $lat2, ?float $lng2): ?int
    {
        if ($lat1 === null || $lng1 === null || $lat2 === null || $lng2 === null) {
            return null;
        }

        $earthRadius = 6371000.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return (int) round($earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a)));
    }
};
