<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * A six-digit password reset code.
 *
 * Delivered as a branded HTML message with a plain-text alternative. It never
 * carries a link: the recipient types the code on the reset screen, so a
 * link-scanning mail gateway cannot consume it.
 */
class PasswordResetOtpMail extends Mailable
{
    use Queueable, SerializesModels;

    public const EXPIRY_MINUTES = 10;

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
            view: 'emails.password-reset-otp',
            text: 'emails.password-reset-otp-text',
            with: [
                'expiryMinutes' => self::EXPIRY_MINUTES,
            ],
        );
    }
}
