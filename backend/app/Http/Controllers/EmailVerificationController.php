<?php

namespace App\Http\Controllers;

use App\Http\Requests\VerifyEmailRequest;
use App\Services\Auth\EmailVerificationService;
use Illuminate\Http\JsonResponse;

/**
 * Public email verification. The URL in the email points at the SPA's
 * /verify-email page; that page posts the token here, and this endpoint is
 * the only thing that decides whether the address becomes verified.
 */
class EmailVerificationController extends Controller
{
    public function __construct(private readonly EmailVerificationService $verifications) {}

    public function verify(VerifyEmailRequest $request): JsonResponse
    {
        $result = $this->verifications->verify((string) $request->validated('token'));

        return response()->json([
            'message' => __('Your email address has been verified. You can now sign in.'),
            'data' => [
                'name' => $result['user']->name,
                'email' => $result['user']->email,
                'email_verified_at' => $result['user']->email_verified_at?->toIso8601String(),
                // Present only for an account that was created without a
                // password: a one-time link to set one, since the owner has
                // now proven control of the mailbox.
                'setup_url' => $result['setup_url'],
            ],
        ]);
    }
}
