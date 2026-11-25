<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The one live email-verification token for an account.
 *
 * The raw token is never stored: `token_hash` is its SHA-256 digest, and the
 * link in the email is the only place the raw value exists. The row is
 * deleted when it is used; a resend replaces it, so an old link stops
 * working immediately.
 */
class EmailVerificationToken extends Model
{
    /** The row is created once and never edited, so there is no updated_at. */
    public const UPDATED_AT = null;

    protected $fillable = [
        'user_id',
        'token_hash',
        'requires_password_setup',
        'expires_at',
        'created_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'requires_password_setup' => 'boolean',
            'expires_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
