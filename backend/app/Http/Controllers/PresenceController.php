<?php

namespace App\Http\Controllers;

use App\Http\Middleware\TrackUserActivity;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The SPA's presence heartbeat.
 *
 * A tab left open on a page nobody clicks would otherwise fall out of the
 * presence window and read Offline while the person is sitting in front of
 * it. The shell pings this on a timer (visible tabs only) so `last_seen_at`
 * keeps moving without requiring a click.
 *
 * It carries no payload and reads nothing: the only effect is the stamp.
 */
class PresenceController extends Controller
{
    public function ping(Request $request): JsonResponse
    {
        $user = $request->user();

        // Forced: the heartbeat's whole point is that it lands even when the
        // throttle would have skipped a request-driven write.
        TrackUserActivity::record($user, force: true);

        return response()->json([
            'data' => [
                'presence' => $user->isOnline() ? 'online' : 'offline',
                'last_seen_at' => $user->last_seen_at?->toIso8601String(),
            ],
        ]);
    }
}
