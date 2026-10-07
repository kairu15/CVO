<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One grant: `role` (the users.role string) may perform `permission`.
 *
 * Deliberately keyed on the role STRING rather than a role table — roles are
 * a fixed application vocabulary (User::ROLES) and every policy already
 * speaks that language. The matrix edits this table directly.
 */
class RolePermission extends Model
{
    protected $fillable = ['role', 'permission_id'];

    public function permission(): BelongsTo
    {
        return $this->belongsTo(Permission::class);
    }
}
