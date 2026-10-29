<?php

namespace App\Http\Requests;

use App\Services\BarangayDispersalAnalyticsService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/analytics/barangay-dispersal and /barangay-flows — the shared
 * filter set for the barangay dispersal analytics.
 *
 * Dates are date-only and interpreted in the application timezone
 * (Asia/Manila): an event at 11:59 PM stays on its own calendar day. The
 * re-dispersal rate ignores the `from` bound by definition (it counts each
 * barangay's whole dispersal history up to `to`), but the rest of the
 * aggregates honour the full window.
 *
 * Access rides the view_analytics capability — route middleware is the first
 * gate, this authorize the second. Row scoping (a technician sees only their
 * assigned households) is applied inside the analytics service's queries.
 */
class BarangayAnalyticsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('view_analytics') ?? false;
    }

    protected function failedAuthorization(): never
    {
        abort(403, 'You do not have permission to view dispersal analytics.');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'from' => ['sometimes', 'nullable', 'date'],
            'to' => ['sometimes', 'nullable', 'date', 'after_or_equal:from'],
            'animal_type_id' => ['sometimes', 'nullable', 'integer', 'exists:animal_types,id'],
            'classification_id' => ['sometimes', 'nullable', 'integer', 'exists:animal_classifications,id'],
            'event_types' => ['sometimes', 'array'],
            'event_types.*' => [Rule::in(BarangayDispersalAnalyticsService::FILTERABLE_EVENT_TYPES)],
            'per_1000' => ['sometimes', 'boolean'],
            'include_cvo' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * The filters, normalized for the analytics service: dates parsed, ids
     * cast, and the event-type list defaulted to "everything the metrics
     * count" (dispersal + both re-dispersal shapes).
     *
     * @return array{from: ?Carbon, to: ?Carbon, animal_type_id: ?int, classification_id: ?int, event_types: list<string>, per_1000: bool, include_cvo: bool}
     */
    public function filters(): array
    {
        $validated = $this->validated();

        $eventTypes = array_values(array_intersect(
            $validated['event_types'] ?? BarangayDispersalAnalyticsService::FILTERABLE_EVENT_TYPES,
            BarangayDispersalAnalyticsService::FILTERABLE_EVENT_TYPES,
        ));

        if ($eventTypes === []) {
            $eventTypes = BarangayDispersalAnalyticsService::FILTERABLE_EVENT_TYPES;
        }

        return [
            'from' => isset($validated['from']) ? Carbon::parse($validated['from'])->startOfDay() : null,
            'to' => isset($validated['to']) ? Carbon::parse($validated['to'])->startOfDay() : null,
            'animal_type_id' => isset($validated['animal_type_id']) ? (int) $validated['animal_type_id'] : null,
            'classification_id' => isset($validated['classification_id']) ? (int) $validated['classification_id'] : null,
            'event_types' => $eventTypes,
            'per_1000' => (bool) ($validated['per_1000'] ?? false),
            'include_cvo' => (bool) ($validated['include_cvo'] ?? false),
        ];
    }
}
