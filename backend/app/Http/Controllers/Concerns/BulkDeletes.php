<?php

namespace App\Http\Controllers\Concerns;

use App\Http\Requests\BulkDeleteRequest;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;

/**
 * One implementation of the "delete the ticked rows" loop, shared by every
 * table that offers bulk delete.
 *
 * Each row is authorized through its own policy exactly like the single-row
 * DELETE endpoint, so bulk delete can never widen what a role is allowed to
 * remove. Rows that are missing or forbidden are reported back as
 * `failed_ids` rather than aborting the request — same partial-failure
 * contract as the bulk technician assignment.
 */
trait BulkDeletes
{
    /**
     * @param  class-string<Model>  $modelClass
     * @param  callable(Model): void  $delete  performs the delete + audit
     * @return JsonResponse { data: { deleted: int, failed_ids: int[] } }
     */
    protected function bulkDelete(BulkDeleteRequest $request, string $modelClass, callable $delete): JsonResponse
    {
        $ids = collect($request->validated('ids'))
            ->map(static fn ($id) => (int) $id)
            ->unique()
            ->values();

        /** @var \Illuminate\Support\Collection<int, Model> $rows */
        $rows = $modelClass::query()->whereIn('id', $ids)->get()->keyBy('id');

        $deleted = 0;
        $failed = [];

        foreach ($ids as $id) {
            $row = $rows->get($id);

            if (! $row instanceof Model || ! $request->user()->can('delete', $row)) {
                $failed[] = $id;

                continue;
            }

            $delete($row);
            $deleted++;
        }

        return response()->json([
            'data' => [
                'deleted' => $deleted,
                'failed_ids' => $failed,
            ],
        ]);
    }
}
