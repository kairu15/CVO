<?php

namespace App\Http\Controllers;

use App\Http\Requests\ReportRequest;
use App\Services\ReportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;

/**
 * City-wide program report — admin-only, read-only, entirely derived.
 *
 * There is no store/update/destroy: a report is a question asked of the
 * recorded data, and the only way to change the answer is to change the
 * records. See ReportService for what is aggregated and why there is no
 * report table.
 */
class ReportController extends Controller
{
    public function __construct(private readonly ReportService $reports) {}

    public function index(ReportRequest $request): JsonResponse
    {
        $validated = $request->validated();

        return response()->json([
            'data' => $this->reports->cityWide(
                $request->user(),
                $validated['barangay'] ?? null,
                isset($validated['from']) ? Carbon::parse($validated['from']) : null,
            ),
        ]);
    }
}
