<?php

namespace App\Http\Resources;

use App\Support\AuditTaxonomy;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of the audit list: enough to scan and triage, without shipping
 * every before/after payload for rows the administrator never opens.
 *
 * The full diff/context is served by GET /admin/activity-logs/{id} and shown
 * in the detail drawer.
 *
 * @property \App\Models\ActivityLog $resource
 */
class ActivityLogSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $module = AuditTaxonomy::moduleFor($this->action, $this->target_type);

        return [
            'id' => $this->id,
            'action' => $this->action,
            'module' => $module,
            'module_label' => AuditTaxonomy::moduleLabel($module),
            'status' => AuditTaxonomy::statusFor($this->action),
            'critical' => AuditTaxonomy::isCritical($this->action),
            'actor' => $this->actorPayload(),
            'actor_id' => $this->actor_id,
            'actor_name' => $this->actor_name,
            'actor_email' => $this->actor_email,
            'actor_role' => $this->actor_role,
            'target_type' => $this->target_type,
            'target_id' => $this->target_id,
            'ip_address' => $this->ip_address,
            'has_diff' => filled($this->old_values) || filled($this->new_values),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }

    /**
     * The actor as at the time of the action, falling back to the loaded
     * relation for rows written before the snapshot columns existed.
     *
     * @return array{id: int|null, name: string|null, email: string|null, role: string|null}|null
     */
    private function actorPayload(): ?array
    {
        $name = $this->actor_name ?? $this->actor?->name;
        $email = $this->actor_email ?? $this->actor?->email;
        $role = $this->actor_role ?? $this->actor?->role;

        if ($this->actor_id === null && $name === null && $role === null) {
            return null;
        }

        return [
            'id' => $this->actor_id,
            'name' => $name,
            'email' => $email,
            'role' => $role,
            'current_role' => $this->actor?->role,
        ];
    }
}
