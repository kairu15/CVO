<?php

namespace App\Http\Controllers;

use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Http\Requests\TokenLoginRequest;
use App\Http\Resources\UserResource;
use App\Services\Auth\AuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class AuthController extends Controller
{
    public function __construct(private readonly AuthService $auth)
    {
    }

    /**
     * Register a new user and start a cookie session (SPA).
     */
    public function register(RegisterRequest $request): JsonResponse
    {
        $user = $this->auth->register(
            name: $request->string('name')->toString(),
            username: $request->string('username')->toString(),
            email: $request->string('email')->toString(),
            password: $request->string('password')->toString(),
        );

        if ($request->hasSession()) {
            Auth::guard('web')->login($user);

            $request->session()->regenerate();
        }

        return (new UserResource($user))->response()->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Log in and start a cookie session (SPA).
     */
    public function login(LoginRequest $request): UserResource
    {
        $user = $this->auth->login(
            identifier: $request->string('identifier')->toString(),
            password: $request->string('password')->toString(),
        );

        if ($request->hasSession()) {
            Auth::guard('web')->login($user);

            $request->session()->regenerate();
        }

        return new UserResource($user);
    }

    /**
     * Log in and return a bearer token (mobile clients).
     */
    public function tokenLogin(TokenLoginRequest $request): JsonResponse
    {
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
     * Return the currently authenticated user.
     */
    public function user(Request $request): UserResource
    {
        return new UserResource($request->user());
    }
}
