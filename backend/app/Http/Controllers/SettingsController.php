<?php

namespace App\Http\Controllers;

use App\Http\Requests\SettingsRequest;
use App\Models\Barangay;
use App\Models\Purok;
use App\Models\Setting;
use App\Services\AuditLogger;
use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

/**
 * System Settings — admin-only.
 *
 * Three sections with three different natures:
 *
 * - The office contact profile is DATA: the office edits it (a phone number
 *   changes when the office moves), so it lives in the settings table.
 *
 * - The vaccination thresholds are a POLICY DECISION the CVO owns: how long
 *   after a vaccination an animal is due again, and how far ahead it warns.
 *   They used to be config-only, which made them a code deploy. They are
 *   writable here and read back by every derived surface through
 *   SettingsService, so the Vaccination Schedule, the smart-alert scan and the
 *   public counts cannot disagree about which animals are late.
 *
 * - The barangay/purok list is reference data with a split personality: a
 *   barangay RENAME would corrupt every historical free-text address that
 *   normalizes against it, so barangays stay name-immutable here (the PATCH
 *   rejects a `barangays` payload outright) while puroks — FK-referenced by
 *   beneficiaries.purok_id, so a rename follows the rows — are fully managed
 *   through the dedicated /admin/barangays endpoints this screen drives.
 *
 * The server's own session lifetimes are shown read-only for the same reason:
 * the framework reads them at boot, so they genuinely cannot change without a
 * restart. Only the SPA's client-side guard is editable, and it is capped
 * below the server's window.
 */
class SettingsController extends Controller
{
    public function __construct(
        private readonly SettingsService $settings,
        private readonly AuditLogger $audit,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->payload()]);
    }

    /** Settings stored as a JSON list rather than a scalar string. */
    private const LIST_KEYS = [
        SettingsService::ANIMAL_TYPES_KEY,
        SettingsService::HEALTH_OUTCOMES_KEY,
        SettingsService::FIELD_VISIT_PURPOSES_KEY,
        SettingsService::CLUSTER_REPORTABLE_OUTCOMES_KEY,
    ];

    public function update(SettingsRequest $request): JsonResponse
    {
        $validated = $request->validated();

        // List-valued settings (the vocabularies) are stored as JSON, not as a
        // scalar string, so they go through their own writer; everything else
        // is a plain key => scalar the generic save handles.
        $lists = Arr::only($validated, self::LIST_KEYS);
        $scalars = Arr::except($validated, self::LIST_KEYS);

        // The keys this save can touch — the diff below is scoped to them.
        $touched = array_values(array_unique([
            ...array_keys(Arr::only($scalars, SettingsService::KEYS)),
            ...array_keys(array_filter($lists, 'is_array')),
        ]));

        // ONE transaction: the saves and the audit row describing them commit
        // together (or neither does). The row keeps its `sections` context AND
        // carries a real before/after of the values that actually changed —
        // read from the table rather than SettingsService::values(), which
        // serves a cache that the save is in the middle of invalidating.
        DB::transaction(function () use ($lists, $scalars, $touched, $validated, $request): void {
            $before = $touched === [] ? [] : Setting::query()
                ->whereIn('key', $touched)
                ->pluck('value', 'key')
                ->all();

            $this->settings->save(Arr::only($scalars, SettingsService::KEYS));

            foreach ($lists as $key => $list) {
                if (is_array($list)) {
                    $this->settings->saveList($key, $list);
                }
            }

            $after = $touched === [] ? [] : Setting::query()
                ->whereIn('key', $touched)
                ->pluck('value', 'key')
                ->all();

            $old = [];
            $new = [];

            foreach ($touched as $key) {
                if (($before[$key] ?? null) === ($after[$key] ?? null)) {
                    continue;
                }

                $old[$key] = $before[$key] ?? null;
                $new[$key] = $after[$key] ?? null;
            }

            // Which sections changed, named — the audit trail should say what
            // an administrator touched; the values ride alongside as diff.
            $this->audit->log($request->user(), 'settings_updated', null, [
                'sections' => array_keys($validated),
            ], $old === [] ? null : $old, $new === [] ? null : $new);
        });

        return response()->json(['data' => $this->payload()]);
    }

    /**
     * The whole screen in one response — every section the SPA renders, so a
     * save and a reload return the identical shape.
     *
     * @return array<string, mixed>
     */
    private function payload(): array
    {
        return [
            'office_profile' => $this->settings->officeProfile(),
            'alerts' => $this->settings->alerts(),
            // The ownership-chain backdating window.
            'dispersal' => ['max_backdate_days' => $this->settings->dispersalMaxBackdateDays()],
            // Field-visit verification + route-planner fallback + cluster
            // scan inputs — all three are policy numbers the office owns.
            'verification' => ['onsite_threshold_m' => $this->settings->onsiteThresholdM()],
            'office_location' => [
                'latitude' => $this->settings->officeLatitude(),
                'longitude' => $this->settings->officeLongitude(),
            ],
            'cluster' => [
                'lookback_days' => $this->settings->clusterLookbackDays(),
                'min_cases' => $this->settings->clusterMinCases(),
                'radius_km' => $this->settings->clusterRadiusKm(),
                'reportable_outcomes' => $this->settings->clusterReportableOutcomes(),
            ],
            'session' => [
                'idle_minutes' => $this->settings->sessionIdleMinutes(),
                // Read-only ceilings. Enforced by the framework's session
                // configuration (config/security.php + SESSION_LIFETIME), so
                // they are display-only — the admin needs to see them to know
                // how far the client window can go.
                'server_idle_minutes' => (int) config('security.session_idle'),
                'server_absolute_minutes' => (int) config('security.session_absolute'),
            ],
            // The suggested species vocabulary, editable. The importer still
            // keeps unknown workbook values as their own type — this list
            // never becomes a filter on existing data.
            'animal_types' => $this->settings->animalTypes(),
            // Which stored event types and smart-alert rules write rows.
            'notifications' => $this->settings->notifications(),
            // Reference data, served with ids + puroks so the page can manage
            // them (via the dedicated /admin/barangays endpoints — the
            // settings PATCH still rejects a `barangays` payload).
            'barangays' => $this->barangaysWithPuroks(),
            // The clinical outcome and field-visit purpose vocabularies,
            // editable. The API validates against exactly the lists returned
            // here — see SettingsService::healthOutcomes / fieldVisitPurposes —
            // so the forms and the server can never disagree.
            'health_outcomes' => $this->settings->healthOutcomes(),
            'field_visit_purposes' => $this->settings->fieldVisitPurposes(),
        ];
    }

    /**
     * The covered barangays with their puroks, ordered the way the public
     * cascade reads (barangay by id, purok by name).
     *
     * @return list<array<string, mixed>>
     */
    private function barangaysWithPuroks(): array
    {
        return Barangay::query()
            ->with('puroks:id,barangay_id,name,latitude,longitude,is_placeholder')
            ->orderBy('id')
            ->get()
            ->map(fn (Barangay $barangay): array => [
                'id' => $barangay->id,
                'name' => $barangay->name,
                'latitude' => (float) $barangay->latitude,
                'longitude' => (float) $barangay->longitude,
                'puroks' => $barangay->puroks
                    ->map(fn (Purok $purok): array => [
                        'id' => $purok->id,
                        'barangay_id' => $purok->barangay_id,
                        'name' => $purok->name,
                        'latitude' => $purok->latitude !== null ? (float) $purok->latitude : null,
                        'longitude' => $purok->longitude !== null ? (float) $purok->longitude : null,
                        'is_placeholder' => (bool) $purok->is_placeholder,
                    ])
                    ->all(),
            ])
            ->all();
    }
}
