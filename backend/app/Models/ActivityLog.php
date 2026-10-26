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
 * `old_values` / `new_values` hold ONLY the fields that changed, masked the
 * same way the UI masks them (App\Support\SensitiveMask): a create has no
 * old_values, a delete no new_values.
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
 * @property array<string, mixed>|null $old_values
 * @property array<string, mixed>|null $new_values
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
        'user_invited',
        'user_updated',
        'user_deactivated',
        'user_reactivated',

        // System administration
        'settings_updated',
        'reference_data_updated',
        'permissions_updated',

        // Animal master list (Animal Type → Classification)
        'animal_type_created',
        'animal_type_updated',
        'animal_type_deleted',
        'animal_classification_created',
        'animal_classification_updated',
        'animal_classification_deleted',

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
        'monitoring_moa_updated',
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

        // Generic model verbs — used by App\Models\Concerns\Auditable for
        // models with no bespoke action name (and for restores, which never
        // had one).
        'created',
        'updated',
        'deleted',
        'restored',

        // File uploads (item 8)
        'file_uploaded',
        'file_deleted',

        // Data in and data out (item 8 — system-wide audit trail)
        'exported',
        'imported',
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
        'old_values',
        'new_values',
    ];

    protected function casts(): array
    {
        return [
            'context' => 'array',
            'old_values' => 'array',
            'new_values' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
