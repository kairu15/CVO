<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    /**
     * Transform the resource into a JSON array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'username' => $this->username,
            'avatar_url' => $this->avatar_url,
            'email' => $this->email,
            'role' => $this->role,
            // Deactivation IS the soft delete (see UserAccountService), so the
            // status the admin table shows is derived from `deleted_at`
            // rather than a second, drift-prone boolean column.
            'status' => $this->deleted_at === null ? 'active' : 'deactivated',
            'deactivated_at' => $this->deleted_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
