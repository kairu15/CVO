<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One public contact-form submission.
 *
 * Written by the public contact endpoint (validated, throttled), forwarded to
 * the office email when a mailer is configured. Nothing reads it publicly;
 * handled_at is reserved for a future admin review view.
 *
 * @property int $id
 * @property string $name
 * @property string $email
 * @property string|null $phone
 * @property string|null $subject
 * @property string $message
 * @property \Illuminate\Support\Carbon|null $handled_at
 */
class ContactMessage extends Model
{
    protected $fillable = [
        'name',
        'email',
        'phone',
        'subject',
        'message',
        'handled_at',
    ];

    protected function casts(): array
    {
        return [
            'handled_at' => 'datetime',
        ];
    }
}
