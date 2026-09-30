<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreSymptomRuleRequest;
use App\Http\Requests\UpdateSymptomRuleRequest;
use App\Http\Resources\SymptomRuleResource;
use App\Models\SymptomRule;
use App\Services\SymptomRuleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rule-Based Health Concern Hints — the editable rule table.
 *
 * Two audiences, one table:
 *
 * - `active` feeds the case-note / health-record entry forms. Any signed-in
 *   staff member may read it; matching then happens in the browser, so typing
 *   never waits on a request.
 * - the CRUD methods are admin-only (the route group enforces it, and the
 *   FormRequests repeat it) so the CVO's veterinarian can correct a hint
 *   without a code change — which is the whole point of making this data
 *   instead of a hardcoded array.
 */
class SymptomRuleController extends Controller
{
    public function __construct(private readonly SymptomRuleService $rules) {}

    /**
     * Active rules for the entry forms, in display order.
     */
    public function active(): AnonymousResourceCollection
    {
        return SymptomRuleResource::collection($this->rules->active());
    }

    /**
     * Every rule, retired ones included — the admin editor.
     */
    public function index(): AnonymousResourceCollection
    {
        return SymptomRuleResource::collection($this->rules->all());
    }

    public function store(StoreSymptomRuleRequest $request): JsonResponse
    {
        $rule = $this->rules->create($request->validated());

        return (new SymptomRuleResource($rule))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    public function update(UpdateSymptomRuleRequest $request, SymptomRule $symptomRule): SymptomRuleResource
    {
        return new SymptomRuleResource(
            $this->rules->update($symptomRule, $request->validated()),
        );
    }

    public function destroy(SymptomRule $symptomRule): JsonResponse
    {
        $this->rules->delete($symptomRule);

        return response()->json([], Response::HTTP_NO_CONTENT);
    }
}
