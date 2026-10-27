<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\FieldVisit;
use Illuminate\Support\Facades\Log;

/**
 * On-site visit verification — the server's verdict on whether a field
 * visit's GPS fix was captured at the beneficiary's registered pin.
 *
 * WHAT THIS IS, AND IS NOT:
 *   The numbers below are computed from stored coordinates by the SERVER on
 *   every save, photo attach and sync replay — never taken from the device.
 *   GPS can be inaccurate, delayed or spoofed, so the verdict is a REVIEW AID
 *   that flags a visit for a human to look at. It is deliberately not called
 *   proof, evidence of presence, or a diagnosis anywhere in this codebase.
 *
 * Precedence (one status per visit, first match wins):
 *   1. no_gps                 — no fix at all (neither photo nor trip fix)
 *   2. no_reference_location  — the beneficiary has no registered pin, so
 *                               there is nothing to compare against (this is
 *                               also the population the admin's "use this
 *                               visit's location" action exists for)
 *   3. low_accuracy           — the fix's accuracy radius is wider than the
 *                               on-site threshold: the fix is too fuzzy to
 *                               place the visit inside or outside the circle
 *   4. on_site / off_site     — distance <= threshold, else outside it
 *
 * The fix used is the PHOTO's capture GPS when a photo exists (that is the
 * moment the brief cares about), falling back to the trip's own fix.
 *
 * The threshold is an administrator setting (`onsite_threshold_m`), not a
 * veterinary or surveying standard — the office picks its own number.
 */
class FieldVisitVerificationService
{
    public const STATUS_ON_SITE = 'on_site';

    public const STATUS_OFF_SITE = 'off_site';

    public const STATUS_LOW_ACCURACY = 'low_accuracy';

    public const STATUS_NO_REFERENCE = 'no_reference_location';

    public const STATUS_NO_GPS = 'no_gps';

    /** Every status the column may hold. */
    public const STATUSES = [
        self::STATUS_ON_SITE,
        self::STATUS_OFF_SITE,
        self::STATUS_LOW_ACCURACY,
        self::STATUS_NO_REFERENCE,
        self::STATUS_NO_GPS,
    ];

    /**
     * The statuses that mean "a human should look at this": off site, too
     * fuzzy to judge, or no registered pin to compare against. `no_gps` is
     * deliberately NOT in the set — a visit logged without a fix is ordinary,
     * not a discrepancy.
     */
    public const REVIEW_STATUSES = [
        self::STATUS_OFF_SITE,
        self::STATUS_LOW_ACCURACY,
        self::STATUS_NO_REFERENCE,
    ];

    /** Statuses the "Off-site / needs review" filter accepts. */
    public const FILTERS = ['all', ...self::STATUSES, 'review'];

    public function __construct(
        private readonly SettingsService $settings,
        private readonly AuditLogger $audit,
    ) {}

    /** The office's configured on-site radius, in metres. */
    public function thresholdM(): int
    {
        return $this->settings->onsiteThresholdM();
    }

    /**
     * Evaluate one fix against one registered pin. Pure — the inputs are
     * plain numbers, so the rule is testable without a database.
     *
     * @return array{status: string, distance_m: int|null, gps_accuracy_m: float|null}
     */
    public function evaluate(
        ?float $fixLat,
        ?float $fixLng,
        ?float $accuracyM,
        ?float $referenceLat,
        ?float $referenceLng,
        ?int $thresholdM = null,
    ): array {
        $threshold = $thresholdM ?? $this->thresholdM();

        $distance = FieldVisitService::distanceMeters($fixLat, $fixLng, $referenceLat, $referenceLng);

        $status = match (true) {
            $fixLat === null || $fixLng === null => self::STATUS_NO_GPS,
            $referenceLat === null || $referenceLng === null => self::STATUS_NO_REFERENCE,
            $accuracyM !== null && $accuracyM > $threshold => self::STATUS_LOW_ACCURACY,
            $distance !== null && $distance <= $threshold => self::STATUS_ON_SITE,
            default => self::STATUS_OFF_SITE,
        };

        return [
            'status' => $status,
            'distance_m' => $distance,
            'gps_accuracy_m' => $accuracyM,
        ];
    }

    /**
     * Re-evaluate a visit from its stored coordinates and persist the result.
     * Writes an audit row when the status CHANGES, so the trail records each
     * re-derivation (including the ones a sync replay triggers).
     *
     * @return array{status: string, distance_m: int|null, gps_accuracy_m: float|null}
     */
    public function refresh(FieldVisit $visit): array
    {
        $visit->loadMissing(['beneficiary', 'photos']);

        $photo = $visit->photos->sortByDesc('id')->first();
        $fixLat = $photo?->latitude ?? $visit->latitude;
        $fixLng = $photo?->longitude ?? $visit->longitude;
        $accuracy = $photo?->accuracy_m ?? null;

        $beneficiary = $visit->beneficiary;

        $result = $this->evaluate(
            $fixLat,
            $fixLng,
            $accuracy !== null ? (float) $accuracy : null,
            $beneficiary?->latitude !== null ? (float) $beneficiary->latitude : null,
            $beneficiary?->longitude !== null ? (float) $beneficiary->longitude : null,
        );

        $previous = $visit->verification_status;

        $visit->forceFill([
            'distance_m' => $result['distance_m'],
            'gps_accuracy_m' => $result['gps_accuracy_m'],
            'verification_status' => $result['status'],
        ])->saveQuietly();

        if ($previous !== $result['status']) {
            try {
                // Actor: whoever is saving now (their own trip, their sync
                // replay), falling back to the visiting technician when the
                // recompute runs without a request context.
                $this->audit->log(
                    auth()->user()?->id ?? $visit->technician_id,
                    'field_visit_verification',
                    $visit,
                    [
                        'status' => $result['status'],
                        'previous_status' => $previous,
                        'distance_m' => $result['distance_m'],
                        'threshold_m' => $this->thresholdM(),
                    ],
                    $previous === null ? null : ['verification_status' => $previous],
                    ['verification_status' => $result['status']],
                );
            } catch (\Throwable $e) {
                // A verdict that could not be logged must not lose the visit
                // it describes — same policy as non-transactional audit rows.
                Log::warning('verification audit failed', ['visit' => $visit->id, 'error' => $e->getMessage()]);
            }
        }

        return $result;
    }

    /**
     * Re-evaluate every visit of one household — called when the household
     * GAINS a registered pin (the admin's "use this visit's location"
     * action), because the reference side of every earlier verdict just moved.
     *
     * @return int visits re-evaluated
     */
    public function refreshForBeneficiary(Beneficiary $beneficiary): int
    {
        $visits = FieldVisit::query()->where('beneficiary_id', $beneficiary->id)->get();

        foreach ($visits as $visit) {
            $this->refresh($visit);
        }

        return $visits->count();
    }
}
