<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BeneficiaryController;
use App\Http\Controllers\MonitoringRecordController;
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

    // Beneficiaries & livestock monitoring
    Route::apiResource('beneficiaries', BeneficiaryController::class);
    Route::apiResource('monitoring-records', MonitoringRecordController::class);

    // Admin: account roles and technician assignment
    Route::prefix('admin')->middleware(\App\Http\Middleware\EnsureUserIsAdmin::class)->group(function (): void {
        Route::get('/users', [AdminController::class, 'users'])->name('api.admin.users');
        Route::patch('/users/{id}/role', [AdminController::class, 'assignRole'])->name('api.admin.users.assign-role');
        Route::get('/beneficiaries', [AdminController::class, 'beneficiaries'])->name('api.admin.beneficiaries');
        Route::patch('/beneficiaries/{id}/assign-technician', [AdminController::class, 'assignTechnician'])->name('api.admin.beneficiaries.assign-technician');
    });
});
