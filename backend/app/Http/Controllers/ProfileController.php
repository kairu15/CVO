<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdatePasswordRequest;
use App\Http\Requests\UpdateProfileRequest;
use App\Services\ProfileService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The authenticated user's own profile.
 *
 * Every method operates on $request->user() only — no id parameter is
 * accepted anywhere, so the endpoints cannot be aimed at another account.
 */
class ProfileController extends Controller
{
    public function __construct(private readonly ProfileService $profiles) {}

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
     * Multipart photo upload — validated here (not just in the file picker)
     * so a hand-crafted request can't store anything but a small image.
     */
    public function storeAvatar(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'avatar' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:2048'],
        ]);

        return response()->json([
            'data' => $this->profiles->updateAvatar($request->user(), $validated['avatar']),
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
        $request->user()->fill([
            'password' => $request->validated('password'),
        ])->save();

        return response()->json([], 204);
    }
}
