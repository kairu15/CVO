<?php

namespace App\Http\Controllers;

use App\Http\Requests\SettingsRequest;
use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Arr;

/**
 * System Settings — admin-only.
 *
 * Two sections with two very different natures:
 *
 * - The office contact profile is DATA: the office edits it (phone number
 *   changes when the office moves), so it lives in the settings table and
 *   this controller writes it.
 *
 * - The barangay list is CONFIGURATION: it validates every beneficiary
 *   address and normalizes historical rows against it, so renaming a barangay
 *   here would corrupt data elsewhere. It is served read-only — the API hands
 *   it to the page for display, and refuses to store an edited copy.
 */
class SettingsController extends Controller
{
    public function __construct(private readonly SettingsService $settings) {}

    public function index(): JsonResponse
    {
        return response()->json([
            'data' => [
                'office_profile' => $this->settings->officeProfile(),
                'barangays' => config('cvo.barangays'),
                'vocabulary' => [
                    'health_outcomes' => config('cvo.health_outcomes'),
                    'field_visit_purposes' => config('cvo.field_visit_purposes'),
                ],
            ],
        ]);
    }

    public function update(SettingsRequest $request): JsonResponse
    {
        $validated = $request->validated();

        return response()->json([
            'data' => [
                'office_profile' => $this->settings->saveOfficeProfile(
                    Arr::only($validated, SettingsService::KEYS),
                ),
                'barangays' => config('cvo.barangays'),
                'vocabulary' => [
                    'health_outcomes' => config('cvo.health_outcomes'),
                    'field_visit_purposes' => config('cvo.field_visit_purposes'),
                ],
            ],
        ]);
    }
}
