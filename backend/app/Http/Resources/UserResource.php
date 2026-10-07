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
            // The capability keys this account's role holds (the
            // role_permissions matrix). Lets the SPA hide what the server
            // would refuse anyway — never a substitute for the server check.
            'permissions' => $this->permissions(),
            // Deactivation IS the soft delete (see UserAccountService), so the
            // status the admin table shows is derived from `deleted_at`
            // rather than a second, drift-prone boolean column.
            'status' => $this->deleted_at === null ? 'active' : 'deactivated',
            'deactivated_at' => $this->deleted_at?->toIso8601String(),
            // Account metadata for the management screen: the stamp every
            // successful sign-in rewrites, and the administrator who created
            // the account (null for self-registered farmers).
            'last_login_at' => $this->last_login_at?->toIso8601String(),
            'created_by' => $this->created_by,
            'created_by_name' => $this->whenLoaded('creator', fn () => $this->creator?->name),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
