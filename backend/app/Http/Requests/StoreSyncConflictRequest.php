<?php

namespace App\Http\Requests;

use App\Models\SyncConflict;
use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A client-side sync conflict being written to the audit log.
 *
 * Any authenticated role may log its own conflicts (the row is always stamped
 * with the caller — a client cannot log one on someone else's behalf). The
 * entity vocabulary is the only merge that exists today; extend it here when a
 * new offline-editable record type appears.
 */
class StoreSyncConflictRequest extends FormRequest
{
    public function authorize(): bool
    {
        return in_array($this->user()->role, User::ROLES, true);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'entity_type' => ['required', 'string', Rule::in(['field_visit', 'case_note'])],
            'entity_id' => ['required', 'integer', 'min:1'],
            'kind' => ['required', 'string', 'max:40'],
            'queued_at' => ['required', 'date'],
            'server_updated_at' => ['nullable', 'date'],
            'resolution' => [
                'required',
                'string',
                Rule::in([SyncConflict::RESOLUTION_OVERWRITE, SyncConflict::RESOLUTION_KEEP_SERVER]),
            ],
            'summary' => ['nullable', 'string', 'max:255'],
        ];
    }
}
