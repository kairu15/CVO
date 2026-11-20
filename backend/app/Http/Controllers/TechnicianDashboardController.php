<?php

namespace App\Http\Controllers;

use App\Services\TechnicianDashboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TechnicianDashboardController extends Controller
{
    public function __construct(private readonly TechnicianDashboardService $dashboard) {}

    /**
     * One role-scoped aggregate: today's plans, assigned households, visits
     * due, recent activity and place counts.
     */
    public function index(Request $request): JsonResponse
    {
        abort_unless(
            in_array($request->user()->role, ['technician', 'admin'], true),
            403,
        );

        return response()->json([
            'data' => $this->dashboard->overview($request->user()),
        ]);
    }
}
