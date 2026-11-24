<?php

namespace App\Services\Auth;

use App\Mail\PasswordResetOtpMail;
use App\Models\User;
use Illuminate\Support\Carbon;
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
 */
class PasswordResetOtpService
{
    public const CODE_LENGTH = 6;

    public const EXPIRY_MINUTES = 10;

    public const RESEND_SECONDS = 60;

    public const MAX_ATTEMPTS = 5;

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
            // Keep the exception class for diagnosis but never log the body or
            // the code. The uniform API response is unchanged.
            Log::error('Password reset OTP email could not be sent.', [
                'email' => $email,
                'exception' => $e::class,
            ]);
        }

        return true;
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
}
