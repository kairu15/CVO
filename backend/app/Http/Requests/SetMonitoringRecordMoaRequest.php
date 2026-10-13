<?php

namespace App\Http\Requests;

use App\Models\MonitoringRecord;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/monitoring-records/{id}/moa — flip the dispersal's MOA status.
 *
 * The stored value is tri-state (null = not yet recorded, true = signed,
 * false = not signed). This endpoint SETS it explicitly, so the body must
 * carry a real boolean; it never silently defaults, or clearing an
 * unrecorded status would look identical to marking it "No".
 *
 * Authorization lives on the record, not on this request: the route is bound
 * to a single monitoring row and the policy (MonitoringRecordPolicy::setMoa)
 * decides whether this account holds the `monitoring.set-moa` capability.
 */
class SetMonitoringRecordMoaRequest extends FormRequest
{
    public function authorize(): bool
    {
        $record = MonitoringRecord::find($this->route('id'));

        return $record !== null && $this->user()->can('setMoa', $record);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'moa_signed' => ['required', 'boolean'],
        ];
    }
}
