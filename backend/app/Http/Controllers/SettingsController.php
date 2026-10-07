<?php

namespace App\Http\Controllers;

use App\Http\Requests\SettingsRequest;
use App\Models\Barangay;
use App\Models\Purok;
use App\Services\AuditLogger;
use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Arr;

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

    public function update(SettingsRequest $request): JsonResponse
    {
        $validated = $request->validated();

        // The animal-type vocabulary is stored as JSON, not as a scalar
        // string, so it goes through its own writer; everything else is a
        // plain key => scalar the generic save handles.
        $types = $validated['animal_types'] ?? null;
        unset($validated['animal_types']);

        $this->settings->save(Arr::only($validated, SettingsService::KEYS));

        if (is_array($types)) {
            $this->settings->saveAnimalTypes($types);
        }

        // Which sections changed, named — the audit trail should say what an
        // administrator touched without storing every saved value.
        $this->audit->log($request->user(), 'settings_updated', null, [
            'sections' => array_keys($validated),
            'animal_types_changed' => is_array($types),
        ]);

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
            'vocabulary' => [
                'health_outcomes' => config('cvo.health_outcomes'),
                'field_visit_purposes' => config('cvo.field_visit_purposes'),
            ],
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
