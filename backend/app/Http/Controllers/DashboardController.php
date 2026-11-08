<?php

namespace App\Http\Controllers;

use App\Services\DashboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Admin Dashboard Overview — one aggregate endpoint behind the
 * /dashboard/admin command center. Read-only by construction: a dashboard is
 * a question asked of the recorded data, computed by DashboardService from
 * the SAME services the module screens read, so its numbers can never
 * disagree with the pages it links to.
 */
class DashboardController extends Controller
{
    public function __construct(private readonly DashboardService $dashboard) {}

    public function index(Request $request): JsonResponse
    {
        // Second gate beside the route middleware (the admin group's
        // convention): the overview is a program-report surface, so the same
        // capability that opens Reports opens it.
        abort_unless($request->user()->hasPermission('view_reports'), 403);

        return response()->json([
            'data' => $this->dashboard->overview($request->user()),
        ]);
    }
}
