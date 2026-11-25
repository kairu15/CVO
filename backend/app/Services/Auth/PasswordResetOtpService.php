<?php

namespace App\Services\Auth;

use App\Mail\PasswordResetOtpMail;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Six-digit, email-delivered password-reset codes.
 *
 * The plain code exists only long enough to be put into the mailable; the
 * database stores a bcrypt hash. Codes expire after ten minutes, are deleted
 * when used, and are deleted after five wrong guesses. A second request within
 * sixty seconds is refused so the endpoint cannot be used as a mail amplifier.
 *
 * Verifying a code does NOT change the password. It consumes the code and
 * returns a random, single-use reset ticket that lives in the cache for a few
 * minutes. Only a request holding that ticket may set a new password, which
 * is what keeps the password form behind a server-side verification step
 * instead of hiding it in the browser.
 */
class PasswordResetOtpService
{
    public function __construct(private readonly EmailVerificationService $verifications) {}

    public const CODE_LENGTH = 6;

    public const EXPIRY_MINUTES = 10;

    public const RESEND_SECONDS = 60;

    public const MAX_ATTEMPTS = 5;

    /** How long a verified ticket may be exchanged for a password change. */
    public const TICKET_TTL_MINUTES = 15;

    /**
     * Issue a new code and email it. Returns false for an unknown address or a
     * request inside the resend window — in both cases nothing is sent.
     */
    public function issue(string $email): bool
    {
        $email = Str::lower(trim($email));
        $user = User::query()->where('email', $email)->first();

        if (! $user) {
            return false;
        }

        // Only a verified mailbox may complete email-based recovery. An
        // unverified account gets a fresh verification link instead; the API
        // response stays generic, so neither branch reveals the account.
        if ($user->email_verified_at === null) {
            try {
                $this->verifications->issue($user, $user->last_login_at === null);
            } catch (\Throwable $e) {
                // The public endpoint must answer the same 200 whatever
                // happens here; a delivery failure is already logged by the
                // verification service.
                report($e);
            }

            return false;
        }

        $code = DB::transaction(function () use ($email): ?string {
            $existing = DB::table('password_reset_otps')
                ->where('email', $email)
                ->lockForUpdate()
                ->first();

            // A code was issued moments ago. Do not replace it and do not send
            // another mail — this is the 60-second resend guard.
            if ($existing && $existing->created_at !== null
                && Carbon::parse($existing->created_at)->greaterThan(now()->subSeconds(self::RESEND_SECONDS))) {
                return null;
            }

            // random_int is CSPRNG-backed; str_pad keeps leading zeroes, so
            // every code is exactly six digits.
            $code = str_pad((string) random_int(0, 999999), self::CODE_LENGTH, '0', STR_PAD_LEFT);

            DB::table('password_reset_otps')->updateOrInsert(
                ['email' => $email],
                [
                    'code_hash' => Hash::make($code),
                    'attempts' => 0,
                    'expires_at' => now()->addMinutes(self::EXPIRY_MINUTES),
                    'created_at' => now(),
                ],
            );

            return $code;
        });

        if ($code === null) {
            return false;
        }

        try {
            // Sent synchronously: this endpoint is small and the application
            // already relies on the request lifecycle for password recovery.
            // A transport failure is logged without the code; the uniform API
            // response is unchanged.
            Mail::to($user->email)->send(new PasswordResetOtpMail($user->name, $code));
        } catch (\Throwable $e) {
            // Keep the exception class AND its message for diagnosis (an SMTP
            // refusal such as "535 5.7.8 Username and Password not accepted" or
            // a blocked port is the whole reason the code never arrived) but
            // never log the mail body or the code.
            Log::error('Password reset OTP email could not be sent.', [
                'email' => $email,
                'exception' => $e::class,
                'error' => $e->getMessage(),
            ]);
        }

        return true;
    }

    /**
     * Validate a code and, when it is correct, return a single-use reset
     * ticket. The code is consumed here; it is never returned or logged.
     */
    public function verify(string $email, string $code): ?string
    {
        $email = Str::lower(trim($email));

        if (! $this->consume($email, $code)) {
            return null;
        }

        $ticket = Str::random(48);

        Cache::put(
            $this->ticketKey($ticket),
            $email,
            now()->addMinutes(self::TICKET_TTL_MINUTES),
        );

        return $ticket;
    }

    /**
     * Exchange a verified ticket for the right to set a new password. The
     * cache entry is pulled (deleted) in the same operation, so a ticket can
     * never be replayed, and the email bound to it must match the request.
     */
    public function consumeTicket(string $email, string $ticket): bool
    {
        $email = Str::lower(trim($email));

        if ($ticket === '') {
            return false;
        }

        $stored = Cache::pull($this->ticketKey($ticket));

        return is_string($stored) && hash_equals($stored, $email);
    }

    /**
     * Consume a code. Correct codes are deleted immediately (single use);
     * wrong codes increment the attempt count and the fifth deletes the row.
     */
    public function consume(string $email, string $code): bool
    {
        $email = Str::lower(trim($email));

        return (bool) DB::transaction(function () use ($email, $code): bool {
            $row = DB::table('password_reset_otps')
                ->where('email', $email)
                ->lockForUpdate()
                ->first();

            if (! $row) {
                return false;
            }

            if (Carbon::parse($row->expires_at)->isPast()) {
                DB::table('password_reset_otps')->where('email', $email)->delete();

                return false;
            }

            if (Hash::check($code, $row->code_hash)) {
                DB::table('password_reset_otps')->where('email', $email)->delete();

                return true;
            }

            $attempts = (int) $row->attempts + 1;

            if ($attempts >= self::MAX_ATTEMPTS) {
                DB::table('password_reset_otps')->where('email', $email)->delete();
            } else {
                DB::table('password_reset_otps')->where('email', $email)
                    ->update(['attempts' => $attempts]);
            }

            return false;
        });
    }

    /** Cache key for one ticket — only a hash of the value is stored. */
    private function ticketKey(string $ticket): string
    {
        return 'security:password-reset-ticket:'.hash('sha256', $ticket);
    }
}
