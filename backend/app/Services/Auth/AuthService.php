<?php

namespace App\Services\Auth;

use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class AuthService
{
    /**
     * Register a new user and return them.
     */
    public function register(string $name, string $email, string $password): User
    {
        return User::create([
            'name' => $name,
            'email' => $email,
            'password' => $password,
            'role' => 'member',
        ]);
    }

    /**
     * Validate credentials and return the matching user.
     *
     * Stateless by design; the controller starts the session (SPA)
     * or issues a token (mobile) afterwards.
     *
     * @throws ValidationException
     */
    public function login(string $email, string $password): User
    {
        $user = User::where('email', $email)->first();

        if (! $user || ! Hash::check($password, $user->password)) {
            throw ValidationException::withMessages([
                'email' => __('These credentials do not match our records.'),
            ]);
        }

        return $user;
    }

    /**
     * Issue a personal access token for the user (mobile clients).
     */
    public function issueToken(User $user, string $deviceName): string
    {
        return $user->createToken($deviceName)->plainTextToken;
    }

    /**
     * Revoke the current access token (if any) or log out the session.
     */
    public function logout(User $user, bool $hasSession): void
    {
        if ($user->currentAccessToken() instanceof PersonalAccessToken) {
            $user->currentAccessToken()->delete();

            return;
        }

        if ($hasSession) {
            Auth::guard('web')->logout();
        }
    }
}
