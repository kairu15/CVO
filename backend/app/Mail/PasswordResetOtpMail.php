<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * A six-digit password reset code. Plain text only: it is a short operational
 * message, it never carries a link, and the code must be easy to read in any
 * mail client.
 */
class PasswordResetOtpMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $recipientName,
        public readonly string $code,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Your CVO password reset code',
        );
    }

    public function content(): Content
    {
        return new Content(
            text: 'emails.password-reset-otp',
        );
    }
}
