<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One security-relevant event: who did what, to what, from where, when.
 *
 * Written exclusively through App\Services\AuditLogger — which only ever
 * INSERTs — and read through the admin-only activity log endpoint. There is
 * deliberately no update or delete path anywhere in the application.
 *
 * `actor_role` is snapshotted at write time on purpose: role changes are
 * themselves audited events, so a historical row must not change meaning
 * after the fact.
 *
 * @property int $id
 * @property int|null $actor_id
 * @property string|null $actor_role
 * @property string $action
 * @property string|null $target_type
 * @property int|null $target_id
 * @property string|null $ip_address
 * @property string|null $user_agent
 * @property array<string, mixed>|null $context
 * @property \Illuminate\Support\Carbon $created_at
 */
class ActivityLog extends Model
{
    /**
     * Every action the application writes. The AuditLogger validates against
     * this list, so a typo fails loudly instead of writing an unqueryable row.
     *
     * @var list<string>
     */
    public const ACTIONS = [
        // Authentication lifecycle
        'login',
        'logout',
        'logout_all',
        'failed_login',
        'account_locked',
        'token_issued',

        // Password lifecycle
        'password_changed',
        'password_reset_requested',
        'password_reset_completed',

        // Authorization changes
        'role_changed',
        'technician_assigned',

        // Account lifecycle (admin User Management)
        'user_created',
        'user_updated',
        'user_deactivated',
        'user_reactivated',

        // Record CRUD (subject of item 7's coverage)
        'beneficiary_created',
        'beneficiary_updated',
        'beneficiary_deleted',
        'dispersal_created',
        'dispersal_updated',
        'dispersal_deleted',
        'monitoring_created',
        'monitoring_updated',
        'monitoring_deleted',
        'monitoring_accepted',
        'field_visit_created',
        'field_visit_updated',
        'field_visit_deleted',
        'field_visit_photo_uploaded',
        'field_visit_photo_deleted',
        'health_record_created',
        'health_record_updated',
        'health_record_deleted',
        'case_note_created',
        'case_note_updated',
        'case_note_deleted',

        // File uploads (item 8)
        'file_uploaded',
        'file_deleted',
    ];

    public const UPDATED_AT = null;

    protected $fillable = [
        'actor_id',
        'actor_role',
        'action',
        'target_type',
        'target_id',
        'ip_address',
        'user_agent',
        'context',
    ];

    protected function casts(): array
    {
        return [
            'context' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
