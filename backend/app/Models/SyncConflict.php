<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One logged offline-sync conflict.
 *
 * Written when a queued offline edit would overwrite a record the server
 * changed first. Records the decision (last-write-wins overwrite, or the
 * technician kept the server's version) — not a merge, and not a copy of
 * either payload.
 */
class SyncConflict extends Model
{
    /** The technician chose their offline version (last-write-wins). */
    public const RESOLUTION_OVERWRITE = 'overwrite';

    /** The technician kept the newer server version and dropped their edit. */
    public const RESOLUTION_KEEP_SERVER = 'keep_server';

    protected $fillable = [
        'user_id',
        'entity_type',
        'entity_id',
        'kind',
        'queued_at',
        'server_updated_at',
        'resolution',
        'summary',
    ];

    protected function casts(): array
    {
        return [
            'queued_at' => 'datetime',
            'server_updated_at' => 'datetime',
        ];
    }

    /**
     * The user who was syncing when the conflict was detected.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
