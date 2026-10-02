<?php

namespace App\Http\Controllers;

use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Http\Requests\TokenLoginRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\Auth\AccountLockout;
use App\Services\Auth\AuthService;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class AuthController extends Controller
{
    public function __construct(
        private readonly AuthService $auth,
        private readonly AccountLockout $lockout,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Register a new user and start a cookie session (SPA).
     */
    public function register(RegisterRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $user = $this->auth->register(
            name: $request->string('name')->toString(),
            username: $request->string('username')->toString(),
            email: $request->string('email')->toString(),
            password: $request->string('password')->toString(),
            dispersal: $validated['dispersal'] ?? null,
        );

        if ($request->hasSession()) {
            Auth::guard('web')->login($user);

            $request->session()->regenerate();

            // Item 1: stamp the login time for AbsoluteSessionExpiry — the
            // ABSOLUTE ceiling on the session (the regenerated session id
            // guarantees the stamp belongs to this authentication, and the
            // idle lifetime governed by SESSION_LIFETIME starts fresh too).
            $request->session()->put(\App\Http\Middleware\AbsoluteSessionExpiry::LOGIN_AT, now()->toIso8601String());
        }

        return (new UserResource($user))->response()->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Log in and start a cookie session (SPA).
     */
    public function login(LoginRequest $request): UserResource|JsonResponse
    {
        if ($locked = $this->rejectIfLocked($request)) {
            return $locked;
        }

        $user = $this->auth->login(
            identifier: $request->string('identifier')->toString(),
            password: $request->string('password')->toString(),
        );

        if ($request->hasSession()) {
            // "Remember me" issues the recaller cookie (config auth.guards.web
            // .remember): the session cookie itself still follows
            // SESSION_LIFETIME, but the recaller lets the guard re-establish
            // the session after it would otherwise lapse.
            Auth::guard('web')->login($user, $request->boolean('remember'));

            $request->session()->regenerate();

            // Item 1: same stamp as register — see the comment there.
            $request->session()->put(\App\Http\Middleware\AbsoluteSessionExpiry::LOGIN_AT, now()->toIso8601String());
        }

        return new UserResource($user);
    }

    /**
     * Log in and return a bearer token (mobile clients).
     */
    public function tokenLogin(TokenLoginRequest $request): JsonResponse
    {
        if ($locked = $this->rejectIfLocked($request)) {
            return $locked;
        }

        $user = $this->auth->login(
            identifier: $request->string('email')->toString(),
            password: $request->string('password')->toString(),
        );

        $token = $this->auth->issueToken($user, $request->string('device_name')->toString());

        return response()->json([
            'user' => new UserResource($user),
            'token' => $token,
        ]);
    }

    /**
     * Pre-flight lockout check shared by both login endpoints.
     *
     * Runs BEFORE credential validation so a brute-forcing client burns its
     * request budget on 423s rather than on password guesses. Adds a
     * Retry-After header so a legitimate user's client can show a countdown.
     */
    private function rejectIfLocked(Request $request): ?JsonResponse
    {
        $identifier = Str::lower(trim(
            (string) ($request->input('identifier') ?? $request->input('email') ?? ''),
        ));

        if ($identifier === '') {
            return null;
        }

        $user = User::query()
            ->where('email', $identifier)
            ->orWhere('username', $identifier)
            ->first();

        if (! $user || ! $this->lockout->isLocked($user)) {
            return null;
        }

        $this->audit->log($user, 'failed_login', User::class, [
            'reason' => 'attempt_while_locked',
        ]);

        return response()->json([
            'message' => __('Too many failed attempts. Try again later.'),
            'errors' => [
                'identifier' => [__('Too many failed attempts. Try again later.')],
            ],
        ], 423)->withHeaders([
            'Retry-After' => (string) $this->lockout->lockedForSeconds($user),
        ]);
    }

    /**
     * Revoke the current token (mobile) or destroy the session (SPA).
     */
    public function logout(Request $request): JsonResponse
    {
        $this->auth->logout($request->user(), $request->hasSession());

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->json(['message' => 'Logged out successfully.']);
    }

    /**
     * "Log out of all devices" (item 1): revoke every bearer token and kill
     * every cookie session the account holds. Works for both client types;
     * after this call the caller must re-authenticate like everyone else.
     */
    public function logoutAll(Request $request): JsonResponse
    {
        $revoked = $this->auth->logoutEverywhere($request->user());

        // The CURRENT session/token is among the revoked ones, so the caller
        // is fully signed out too — that is the point of the button.
        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        $this->audit->log($request->user(), 'logout_all', User::class, [
            'tokens_revoked' => $revoked,
        ]);

        return response()->json(['message' => 'Logged out of all devices.', 'meta' => ['tokens_revoked' => $revoked]]);
    }

    /**
     * Return the currently authenticated user.
     */
    public function user(Request $request): UserResource
    {
        return new UserResource($request->user());
    }
}
