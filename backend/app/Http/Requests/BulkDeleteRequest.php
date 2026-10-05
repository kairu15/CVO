<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Shared payload for a bulk delete: the ids the caller ticked in a table.
 *
 * The ids are NOT validated against a table here — each controller resolves
 * them against its own model and authorizes every row individually, so an id
 * that no longer exists (or that this user may not delete) lands in the
 * response's `failed_ids` instead of failing the whole batch with a 422.
 * A stale selection should never block deleting the rows that are still good.
 */
class BulkDeleteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:500'],
            'ids.*' => ['integer', 'distinct'],
        ];
    }
}
