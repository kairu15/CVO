<?php

namespace App\Http\Controllers;

use App\Services\PublicTransparencyService;
use Illuminate\Http\JsonResponse;

/**
 * Public (unauthenticated) program transparency statistics.
 *
 * Read-only and aggregate-only — see PublicTransparencyService for the privacy
 * boundary and the backend test that enforces it.
 */
class PublicTransparencyController extends Controller
{
    public function __construct(private readonly PublicTransparencyService $transparency) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->transparency->summary()]);
    }
}
