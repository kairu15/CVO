<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * "An administrator created a staff account — verify your email."
 *
 * The link points at the SPA's /verify-email page, which posts the token to
 * the API. Verification is decided server-side; the page only displays the
 * result, so the link works from any device or browser that can open Gmail.
 */
class StaffEmailVerificationMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $recipientName,
        public readonly string $recipientEmail,
        public readonly string $verificationUrl,
        public readonly int $expiresInHours,
        public readonly string $role,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Verify your CVO Management System email address',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.staff-email-verification',
            text: 'emails.staff-email-verification-text',
            with: [
                'roleLabel' => $this->role === 'admin' ? 'Administrator' : 'Field Technician',
            ],
        );
    }
}
