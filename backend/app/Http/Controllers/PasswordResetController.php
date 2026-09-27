<?php

namespace App\Http\Controllers;

use App\Http\Requests\ForgotPasswordRequest;
use App\Http\Requests\ResetPasswordRequest;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Auth\AccountLockout;
use App\Services\Auth\AuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Password;

/**
 * Password recovery (item 3).
 *
 * Built on Laravel's Password broker: hashed, single-use, time-limited
 * tokens in password_reset_tokens (auth.passwords.users.expire, 60 min) with
 * a per-address throttle (same config, 'throttle' => 60s). Timebox equalizes
 * response time between existing and non-existing accounts, and this
 * controller ALWAYS answers 200 with the same body — the client can never
 * learn whether an email exists.
 *
 * After a successful reset the account's other sessions/tokens are revoked
 * (forced re-authentication), the brute-force lockout is cleared (the person
 * who proved email ownership is not the brute-forcer), and everything is
 * audited.
 */
class PasswordResetController extends Controller
{
    public function __construct(
        private readonly AuthService $auth,
        private readonly AccountLockout $lockout,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Request a reset link. Uniform response, always 200.
     */
    public function sendResetLink(ForgotPasswordRequest $request): JsonResponse
    {
        $email = $request->validated('email');

        $status = Password::sendResetLink(['email' => $email]);

        if ($status === Password::RESET_LINK_SENT) {
            $user = User::query()->where('email', $email)->first();

            if ($user) {
                $this->audit->log($user, 'password_reset_requested', User::class);
            }
        }

        // INVALID_USER, RESET_THROTTLED — identical shape, identical status.
        return response()->json([
            'message' => __('If that email address is in our records, a password reset link has been sent.'),
        ]);
    }

    /**
     * Complete the reset with the emailed token.
     */
    public function reset(ResetPasswordRequest $request): JsonResponse
    {
        $status = Password::reset(
            $request->only('email', 'password', 'password_confirmation', 'token'),
            function (User $user, string $password): void {
                $user->forceFill([
                    'password' => $password,
                ])->save();

                // Item 3: after a successful reset, every other session/token
                // dies — the device that completed the reset keeps nothing
                // either (the plain-text token was just used once; requiring
                // a fresh login everywhere is the safer default).
                $this->auth->logoutEverywhere($user);

                $this->audit->log($user, 'password_reset_completed', User::class);
            },
        );

        if ($status === Password::PASSWORD_RESET) {
            // The account may have been brute-locked; the reset proves
            // ownership and clears the lockout.
            $user = User::query()->where('email', $request->validated('email'))->first();

            if ($user) {
                $this->lockout->resetForPasswordReset($user);
            }

            return response()->json(['message' => __('Your password has been reset. You can now sign in.')]);
        }

        // INVALID_TOKEN / INVALID_USER / RESET_THROTTLED: a validation-style
        // 422 with the broker's message — single-use and expiry are enforced
        // upstream, so a replayed or expired token lands here.
        return response()->json([
            'message' => __($status),
            'errors' => ['token' => [__($status)]],
        ], 422);
    }
}
