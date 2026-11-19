<?php

namespace App\Http\Resources;

use App\Support\AuditTaxonomy;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One audit trail row for the admin dashboard (item 7).
 *
 * @property \App\Models\ActivityLog $resource
 */
class ActivityLogResource extends JsonResource
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
            'actor' => $this->whenLoaded('actor', fn () => $this->actor ? [
                'id' => $this->actor->id,
                'name' => $this->actor_name ?? $this->actor->name,
                'email' => $this->actor_email ?? $this->actor->email,
                'role' => $this->actor_role ?? $this->actor->role,
                'current_role' => $this->actor->role,
                'deactivated' => $this->actor->trashed(),
            ] : ($this->actor_id ? [
                'id' => $this->actor_id,
                'name' => $this->actor_name,
                'email' => $this->actor_email,
                'role' => $this->actor_role,
                'current_role' => null,
                'deactivated' => true,
            ] : null)),
            'actor_id' => $this->actor_id,
            'actor_name' => $this->actor_name,
            'actor_email' => $this->actor_email,
            'actor_role' => $this->actor_role,
            'target_type' => $this->target_type,
            'target_id' => $this->target_id,
            'ip_address' => $this->ip_address,
            'user_agent' => $this->user_agent,
            'context' => $this->context,
            // The before/after pair behind the row's expandable diff — null
            // for rows written before the diff columns existed.
            'old_values' => $this->old_values,
            'new_values' => $this->new_values,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
