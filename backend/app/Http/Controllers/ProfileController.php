<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreAvatarRequest;
use App\Http\Requests\UpdatePasswordRequest;
use App\Http\Requests\UpdateProfileRequest;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\ProfileService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * The authenticated user's own profile.
 *
 * Every method operates on $request->user() only — no id parameter is
 * accepted anywhere, so the endpoints cannot be aimed at another account.
 */
class ProfileController extends Controller
{
    public function __construct(
        private readonly ProfileService $profiles,
        private readonly \App\Services\Auth\AuthService $auth,
        private readonly AuditLogger $audit,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->profiles->profile($request->user()),
        ]);
    }

    public function update(UpdateProfileRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->profiles->update($request->user(), $request->validated()),
        ]);
    }

    /**
     * Multipart photo upload — validated on the FormRequest (items 5 + 8):
     * content-sniffed image type, extension allow-list, size cap; EXIF is
     * stripped and the file stored privately by ProfileService.
     */
    public function storeAvatar(StoreAvatarRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->profiles->updateAvatar($request->user(), $request->file('avatar')),
        ]);
    }

    public function destroyAvatar(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->profiles->deleteAvatar($request->user()),
        ]);
    }

    public function updatePassword(UpdatePasswordRequest $request): JsonResponse
    {
        $user = $request->user();

        $user->fill([
            'password' => $request->validated('password'),
        ])->save();

        // Item 1: a password change kills every OTHER session/token — the
        // device that proved the current password keeps its session; anything
        // else (a stolen cookie on another device, an old mobile token) is
        // revoked. Sanctum's AuthenticateSession middleware handles the
        // current session cookie's password hash check; this covers the rest.
        $this->auth->revokeOtherSessions(
            $user,
            $request->hasSession() ? $request->session()->getId() : null,
            $user->currentAccessToken() instanceof PersonalAccessToken ? $user->currentAccessToken() : null,
        );

        $this->audit->log($user, 'password_changed', User::class);

        return response()->json([], 204);
    }
}
