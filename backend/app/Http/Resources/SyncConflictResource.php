<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One logged sync conflict — read by the admin audit view.
 */
class SyncConflictResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'user' => new UserResource($this->whenLoaded('user')),
            'entity_type' => $this->entity_type,
            'entity_id' => $this->entity_id,
            'kind' => $this->kind,
            'queued_at' => $this->queued_at?->toIso8601String(),
            'server_updated_at' => $this->server_updated_at?->toIso8601String(),
            'resolution' => $this->resolution,
            'summary' => $this->summary,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
