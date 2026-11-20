<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreFieldVisitPlanRequest;
use App\Http\Requests\UpdateFieldVisitPlanRequest;
use App\Models\FieldVisitPlan;
use Illuminate\Http\JsonResponse;

class FieldVisitPlanController extends Controller
{
    public function store(StoreFieldVisitPlanRequest $request): JsonResponse
    {
        $plan = FieldVisitPlan::create([
            'beneficiary_id' => $request->validated('beneficiary_id'),
            'technician_id' => $request->user()->id,
            'planned_for' => $request->validated('planned_for'),
            'purpose' => $request->validated('purpose'),
            'notes' => $request->validated('notes'),
            'status' => FieldVisitPlan::STATUS_PENDING,
        ]);

        return response()->json([
            'data' => $this->payload($plan),
        ], 201);
    }

    public function update(UpdateFieldVisitPlanRequest $request, FieldVisitPlan $plan): JsonResponse
    {
        $validated = $request->validated();
        $status = $validated['status'] ?? $plan->status;
        $wasCompleted = $plan->status === FieldVisitPlan::STATUS_COMPLETED;

        $plan->fill($validated);

        if ($status === FieldVisitPlan::STATUS_COMPLETED) {
            if (! $wasCompleted) {
                $plan->completed_at = now();
            }
        } else {
            // Reopening a plan clears its completion link as well, so a plan
            // cannot claim to be pending while pointing at a finished visit.
            $plan->completed_at = null;
            $plan->field_visit_id = null;
        }

        $plan->save();

        return response()->json([
            'data' => $this->payload($plan->refresh()),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(FieldVisitPlan $plan): array
    {
        return [
            'id' => $plan->id,
            'beneficiary_id' => $plan->beneficiary_id,
            'planned_for' => $plan->planned_for?->toDateString(),
            'purpose' => $plan->purpose,
            'status' => $plan->status,
            'completed_at' => $plan->completed_at?->toIso8601String(),
            'field_visit_id' => $plan->field_visit_id,
        ];
    }
}
