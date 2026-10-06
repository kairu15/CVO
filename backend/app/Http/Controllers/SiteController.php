<?php

namespace App\Http\Controllers;

use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;

/**
 * Public (unauthenticated) site metadata.
 *
 * Why this endpoint exists: the office contact details an administrator edits
 * in System Settings have to actually REACH the pages that show them. They are
 * rendered on the landing page, the farmer Support page and the
 * password-reset note — all session-free — so without a public read path the
 * editable copy in the settings table would sit next to a hard-coded
 * placeholder that the public still saw. That would make "change it from the
 * UI, no deploy needed" untrue.
 *
 * Nothing sensitive is exposed: the office's published contact details and the
 * SPA's own client-side inactivity window (a UX preference, not a secret).
 * The server's real session lifetimes are deliberately NOT here — those stay
 * on the admin-only settings payload.
 *
 * Cached and throttled like the other public endpoints, so anonymous traffic
 * cannot become a query amplifier.
 */
class SiteController extends Controller
{
    public function __construct(private readonly SettingsService $settings) {}

    public function show(): JsonResponse
    {
        return response()->json([
            'data' => [
                'office' => $this->settings->officeProfile(),
                'session' => [
                    // The client guard's window. Safe to publish: it is what
                    // the SPA signs itself out after, not what the server
                    // enforces.
                    'idle_minutes' => $this->settings->sessionIdleMinutes(),
                ],
            ],
        ]);
    }
}
