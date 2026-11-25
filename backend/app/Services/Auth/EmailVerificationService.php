<?php

namespace App\Services\Auth;

use App\Mail\StaffEmailVerificationMail;
use App\Models\EmailVerificationToken;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Email verification for staff accounts.
 *
 * A token is 64 random characters. Only its SHA-256 hash is stored, one live
 * row per account, so a resend replaces the previous link instead of adding a
 * second one. The row carries its own expiry (config security.
 * email_verification_expiry_hours) and is deleted the moment it is used, so
 * neither an old link nor a replayed one can verify twice.
 *
 * Verification is always decided on the server, from the token in the URL.
 * The SPA's /verify-email page only posts that token and renders the answer,
 * which is why the emailed link works from any browser or device.
 */
class EmailVerificationService
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** How long a freshly issued link stays valid. */
    public static function expiryHours(): int
    {
        return max(1, (int) config('security.email_verification_expiry_hours', 24));
    }

    /**
     * Issue a new verification link and email it.
     *
     * Any earlier token for the account is replaced in the same transaction,
     * so exactly one link works at a time.
     *
     * @param  bool  $requiresPasswordSetup  The account was created without a
     *                                       password, so a successful
     *                                       verification may also return a
     *                                       one-time setup link.
     * @return array{expires_at: Carbon, sent: bool}
     *
     * @throws ValidationException when the address is already verified.
     */
    public function issue(User $user, bool $requiresPasswordSetup = false): array
    {
        if ($user->email_verified_at !== null) {
            throw ValidationException::withMessages([
                'email' => 'This email address is already verified.',
            ]);
        }

        $token = Str::random(64);
        $expiresAt = now()->addHours(self::expiryHours());

        DB::transaction(function () use ($user, $token, $expiresAt, $requiresPasswordSetup): void {
            EmailVerificationToken::query()->updateOrCreate(
                ['user_id' => $user->id],
                [
                    'token_hash' => hash('sha256', $token),
                    'requires_password_setup' => $requiresPasswordSetup,
                    'expires_at' => $expiresAt,
                    'created_at' => now(),
                ],
            );
        });

        return [
            'expires_at' => $expiresAt,
            'sent' => $this->send($user, $token),
        ];
    }

    /**
     * Validate a token and mark the account verified.
     *
     * Everything that can fail — unknown token, expired token, deactivated
     * account, already-used token — is a 422 with a message the SPA can show,
     * and the token row is removed when it is expired or already spent.
     *
     * @return array{user: User, setup_url: string|null}
     *
     * @throws ValidationException
     */
    public function verify(string $token): array
    {
        $hash = hash('sha256', $token);

        // Failures are collected and thrown AFTER the transaction commits:
        // an expired or spent token must still be deleted, and throwing
        // inside would roll that cleanup back.
        $result = DB::transaction(function () use ($hash): array {
            $row = EmailVerificationToken::query()
                ->where('token_hash', $hash)
                ->lockForUpdate()
                ->first();

            if (! $row) {
                return ['error' => 'This verification link is invalid or has already been used.'];
            }

            if ($row->expires_at->isPast()) {
                $row->delete();

                return ['error' => 'This verification link has expired. Ask a CVO administrator to resend it.'];
            }

            $user = User::withTrashed()->find($row->user_id);

            if (! $user) {
                $row->delete();

                return ['error' => 'This verification link is no longer associated with an account.'];
            }

            // An administrator may disable an account while a link is still
            // in an inbox. Reactivation is the way back — never this link.
            // The token is kept so the same link still works after the
            // administrator reactivates the account, within its expiry.
            if ($user->trashed()) {
                return ['error' => 'This account has been disabled. Contact the CVO administrator.'];
            }

            if ($user->email_verified_at !== null) {
                $row->delete();

                return ['error' => 'This verification link has already been used.'];
            }

            $needsPassword = (bool) $row->requires_password_setup;

            $user->forceFill(['email_verified_at' => now()])->save();

            // Single use: the link cannot be replayed, whatever happens next.
            $row->delete();

            $this->audit->log($user, 'email_verified', $user);

            return [
                'user' => $user->refresh(),
                'setup_url' => $needsPassword ? $this->setupUrlFor($user) : null,
            ];
        });

        if (isset($result['error'])) {
            throw $this->invalidLink($result['error']);
        }

        return $result;
    }

    /** The SPA page that renders the result of a verification attempt. */
    public function verificationUrl(string $token): string
    {
        return $this->frontendUrl().'/verify-email?token='.urlencode($token);
    }

    /**
     * One-time password-setup link for an account that verified but has no
     * password of its own. This is the same Laravel password broker token the
     * admin invite flow uses, so the reset endpoint stays the single
     * completion path.
     */
    private function setupUrlFor(User $user): string
    {
        $token = Password::createToken($user);

        return $this->frontendUrl().'/reset-password?token='.$token.'&email='.urlencode($user->email);
    }

    private function frontendUrl(): string
    {
        return rtrim(
            (string) config('app.frontend_url', env('FRONTEND_URL', 'http://localhost:5173')),
            '/',
        );
    }

    /**
     * Send the message. A transport failure is logged without the link or the
     * token, and reported to the caller so the admin can retry — account
     * creation itself must not fail because Gmail was briefly unavailable.
     */
    private function send(User $user, string $token): bool
    {
        try {
            Mail::to($user->email)->send(new StaffEmailVerificationMail(
                recipientName: $user->name,
                recipientEmail: $user->email,
                verificationUrl: $this->verificationUrl($token),
                expiresInHours: self::expiryHours(),
                role: $user->role,
            ));

            return true;
        } catch (\Throwable $e) {
            Log::error('Staff email verification message could not be sent.', [
                'email' => $user->email,
                'exception' => $e::class,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    private function invalidLink(string $message): ValidationException
    {
        return ValidationException::withMessages(['token' => $message]);
    }
}
