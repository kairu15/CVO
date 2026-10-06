<?php

namespace App\Http\Controllers;

use App\Http\Requests\SettingsRequest;
use App\Services\SettingsService;
use App\Support\Barangays;
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
 * - The barangay/purok list is CONFIGURATION: it validates every beneficiary
 *   address and normalizes historical rows against it, so renaming a barangay
 *   here would corrupt data elsewhere. It is served read-only — the API hands
 *   it to the page for display, and refuses to store an edited copy.
 *
 * The server's own session lifetimes are shown read-only for the same reason:
 * the framework reads them at boot, so they genuinely cannot change without a
 * restart. Only the SPA's client-side guard is editable, and it is capped
 * below the server's window.
 */
class SettingsController extends Controller
{
    public function __construct(private readonly SettingsService $settings) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->payload()]);
    }

    public function update(SettingsRequest $request): JsonResponse
    {
        $this->settings->save(Arr::only($request->validated(), SettingsService::KEYS));

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
            'barangays' => Barangays::all(),
            'vocabulary' => [
                'health_outcomes' => config('cvo.health_outcomes'),
                'field_visit_purposes' => config('cvo.field_visit_purposes'),
            ],
        ];
    }
}
