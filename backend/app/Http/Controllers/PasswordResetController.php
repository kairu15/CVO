<?php

namespace App\Http\Controllers;

use App\Http\Requests\ForgotPasswordRequest;
use App\Http\Requests\ResetPasswordRequest;
use App\Http\Requests\VerifyResetCodeRequest;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Auth\AccountLockout;
use App\Services\Auth\AuthService;
use App\Services\Auth\PasswordResetOtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

/**
 * Password recovery.
 *
 * Public "Forgot password?" issues a six-digit, hashed, single-use OTP
 * (PasswordResetOtpService) and always answers with the same 200 body. The
 * code is verified on its own endpoint, which returns a short-lived,
 * single-use reset ticket; only that ticket can complete the reset. The
 * administrator invite flow still completes through Laravel's password broker
 * with a signed `token`, so both paths share the reset endpoint.
 *
 * A completed reset revokes every session/token, clears the brute-force
 * lockout, and writes the matching audit row. Codes and passwords are never
 * logged.
 */
class PasswordResetController extends Controller
{
    public function __construct(
        private readonly AuthService $auth,
        private readonly AccountLockout $lockout,
        private readonly AuditLogger $audit,
        private readonly PasswordResetOtpService $otp,
    ) {}

    /**
     * Request a reset code. Uniform response, always 200.
     */
    public function sendResetLink(ForgotPasswordRequest $request): JsonResponse
    {
        $email = Str::lower(trim((string) $request->validated('email')));

        if ($this->otp->issue($email)) {
            $user = User::query()->where('email', $email)->first();

            if ($user) {
                $this->audit->log($user, 'password_reset_requested', User::class);
            }
        }

        // Unknown address, resend window, and mail transport failure all get
        // this exact answer. The client cannot tell whether an account exists.
        return response()->json([
            'message' => __('If that email address is in our records, a 6-digit reset code has been sent.'),
        ]);
    }

    /**
     * Verify an emailed code. On success the code is consumed and a short-lived
     * reset ticket is returned; no password change happens here.
     */
    public function verifyCode(VerifyResetCodeRequest $request): JsonResponse
    {
        $email = Str::lower(trim((string) $request->validated('email')));

        $ticket = $this->otp->verify($email, (string) $request->validated('otp'));

        if ($ticket === null) {
            return $this->invalidOtpResponse();
        }

        return response()->json([
            'message' => __('Your code has been verified. Choose a new password.'),
            'reset_token' => $ticket,
            'expires_in' => PasswordResetOtpService::TICKET_TTL_MINUTES * 60,
        ]);
    }

    /**
     * Complete the reset with either a verified reset ticket or an invite token.
     */
    public function reset(ResetPasswordRequest $request): JsonResponse
    {
        if ($request->filled('reset_token')) {
            return $this->resetWithVerifiedCode($request);
        }

        return $this->resetWithToken($request);
    }

    private function resetWithVerifiedCode(ResetPasswordRequest $request): JsonResponse
    {
        $email = Str::lower(trim((string) $request->validated('email')));

        if (! $this->otp->consumeTicket($email, (string) $request->validated('reset_token'))) {
            $message = __('Your verification has expired. Start the password reset again.');

            return response()->json([
                'message' => $message,
                'errors' => ['reset_token' => [$message]],
            ], 422);
        }

        $user = User::query()->where('email', $email)->first();

        if (! $user) {
            return $this->invalidOtpResponse();
        }

        $this->completeReset($user, (string) $request->validated('password'));

        return response()->json(['message' => __('Your password has been reset. You can now sign in.')]);
    }

    private function resetWithToken(ResetPasswordRequest $request): JsonResponse
    {
        $status = Password::reset(
            $request->only('email', 'password', 'password_confirmation', 'token'),
            function (User $user, string $password): void {
                $this->completeReset($user, $password);
            },
        );

        if ($status === Password::PASSWORD_RESET) {
            return response()->json(['message' => __('Your password has been reset. You can now sign in.')]);
        }

        // INVALID_TOKEN / INVALID_USER / RESET_THROTTLED: a validation-style
        // 422. The reset page has no token input, so it shows this as a form
        // error.
        return response()->json([
            'message' => __($status),
            'errors' => ['token' => [__($status)]],
        ], 422);
    }

    /**
     * One path for both credentials: save the new password, end every existing
     * session/token, clear the account lockout, and append the audit row.
     */
    private function completeReset(User $user, string $password): void
    {
        DB::transaction(function () use ($user, $password): void {
            $user->forceFill(['password' => $password])->save();

            $this->auth->logoutEverywhere($user);
            $this->lockout->resetForPasswordReset($user);

            $this->audit->log($user, 'password_reset_completed', User::class);
        });
    }

    private function invalidOtpResponse(): JsonResponse
    {
        $message = __('That code is invalid or has expired. Request a new one.');

        return response()->json([
            'message' => $message,
            'errors' => ['otp' => [$message]],
        ], 422);
    }
}
