<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * "An account was created for you" — the invite half of the setup-link flow.
 *
 * The link is the SAME one-time, time-limited password reset mechanism the
 * public flow uses (the Laravel password broker: hashed token, single use,
 * expiry from config auth.passwords.users.expire) pointed at the SPA's
 * /reset-password page — one URL format, one code path that completes it.
 *
 * NOTE ON DELIVERY: this mail goes out over the configured mailer. Where no
 * SMTP service is wired up yet (MAIL_MAILER=log locally), nothing is
 * delivered — which is exactly why the admin API ALSO returns the setup URL
 * in the create-account response, so the office can hand it over directly
 * until a mail service is configured. Going live with real email is an SMTP
 * configuration change, not a code change.
 */
class AccountSetup extends Notification
{
    use Queueable;

    public function __construct(public readonly string $setupUrl) {}

    /**
     * Mail only — there is no database/broadcast channel for this app.
     *
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Your City Veterinary Office account')
            ->greeting('Hello!')
            ->line('An account was created for you on the City Veterinary Office system.')
            ->line('This link opens a one-time form where you set your own password. It expires, and it can only be used once.')
            ->action('Set your password', $this->setupUrl)
            ->line('If you were not expecting this account, you can ignore this message — nothing changes until the link is used.');
    }
}
