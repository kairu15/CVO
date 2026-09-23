<?php

namespace App\Http\Controllers;

use App\Http\Requests\SearchRequest;
use App\Services\SearchService;
use Illuminate\Http\JsonResponse;

/**
 * Global header search — read-only, role-scoped, no policy of its own.
 *
 * Like the derived feeds (notifications, vaccination schedule), there is no
 * model to authorize against: the FormRequest gates who may search at all and
 * SearchService scopes every query to the rows the caller could already list.
 */
class SearchController extends Controller
{
    public function __construct(private readonly SearchService $search) {}

    public function index(SearchRequest $request): JsonResponse
    {
        $result = $this->search->search($request->user(), $request->validated('q'));

        return response()->json(['data' => $result]);
    }
}
