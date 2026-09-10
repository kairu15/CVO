<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ProjectController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes — /api/v1
|--------------------------------------------------------------------------
|
| SPA auth uses Sanctum cookie sessions (stateful, CSRF-protected).
| Mobile clients use bearer tokens issued by the token-login endpoint.
|
*/

// Authentication (rate limited to 6 attempts per minute)
Route::prefix('v1')->middleware('throttle:6,1')->group(function (): void {
    Route::post('/register', [AuthController::class, 'register'])->name('api.register');
    Route::post('/login', [AuthController::class, 'login'])->name('api.login');
    Route::post('/token-login', [AuthController::class, 'tokenLogin'])->name('api.token-login');
});

// Authenticated routes
Route::prefix('v1')->middleware('auth:sanctum')->group(function (): void {
    Route::get('/user', [AuthController::class, 'user'])->name('api.user');
    Route::post('/logout', [AuthController::class, 'logout'])->name('api.logout');

    Route::apiResource('projects', ProjectController::class);
});
