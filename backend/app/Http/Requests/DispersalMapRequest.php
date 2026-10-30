<?php

namespace App\Http\Requests;

use App\Services\DispersalMapService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/map/pins — the dispersal map's dated snapshot request.
 *
 * The date is interpreted in the APPLICATION timezone (Asia/Manila): an event
 * recorded at 11:59 PM stays on its own calendar day. A date with no records
 * is a valid question ("nothing happened then") and answers 200 with an empty
 * snapshot — only a MALFORMED or FUTURE date is rejected with 422, a future
 * one because the map shows what has happened, not forecasts.
 *
 * Access rides the view_flight_path capability — the same one behind every
 * ownership chain. Row scoping (a technician sees only events touching their
 * assigned households) is applied inside DispersalMapService's queries.
 */
class DispersalMapRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasPermission('view_flight_path') ?? false;
    }

    protected function failedAuthorization(): never
    {
        abort(403, 'You do not have permission to view the dispersal map.');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // Optional on purpose: an absent date means "nothing selected" and
            // answers an empty snapshot, so the UI can mount before it knows
            // the latest date.
            'date' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'],
            'mode' => ['nullable', Rule::in(DispersalMapService::MODES)],
        ];
    }

    /**
     * @return array{date: ?Carbon, mode: string}
     */
    public function snapshotFilters(): array
    {
        $validated = $this->validated();

        return [
            'date' => isset($validated['date']) && $validated['date'] !== ''
                ? Carbon::createFromFormat('Y-m-d', $validated['date'], config('app.timezone'))->startOfDay()
                : null,
            'mode' => $validated['mode'] ?? DispersalMapService::MODE_ON,
        ];
    }
}
