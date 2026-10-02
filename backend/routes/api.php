<?php

use App\Http\Controllers\ActivityLogController;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\AnimalHealthController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BarangayController;
use App\Http\Controllers\BeneficiaryController;
use App\Http\Controllers\CaseNoteController;
use App\Http\Controllers\DispersalEventController;
use App\Http\Controllers\FieldVisitController;
use App\Http\Controllers\HealthRecordController;
use App\Http\Controllers\MonitoringRecordController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\PasswordResetController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\PublicMapController;
use App\Http\Controllers\PublicTransparencyController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\SettingsController;
use App\Http\Controllers\SymptomRuleController;
use App\Http\Controllers\VaccinationScheduleController;
use App\Http\Middleware\EnsureUserIsAdmin;
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

    // Password recovery (item 3). Token-based via Laravel's Password broker:
    // signed, single-use, time-limited (config auth.passwords.users.expire).
    // Always answers 200 regardless of whether the email exists — no account
    // enumeration. Inside the same 6/min throttle as login so reset cannot be
    // used to spam or to probe accounts faster than login allows.
    Route::post('/forgot-password', [PasswordResetController::class, 'sendResetLink'])
        ->name('api.password.email');
    Route::post('/reset-password', [PasswordResetController::class, 'reset'])
        ->name('api.password.reset');

    // Location reference data for the public forms — the registration
    // form's barangay → purok cascade. Read-only and session-free: these
    // are reference tables, not user data, so they need no auth. Ordered
    // by id (the config seed order) so the dropdown reads as a stable list.
    Route::get('/barangays', [BarangayController::class, 'index'])->name('api.barangays');
    Route::get('/barangays/{barangay}/puroks', [BarangayController::class, 'puroks'])
        ->middleware('throttle:60,1')
        ->name('api.barangays.puroks');

    // GPS/pin → barangay/purok auto-detect for the registration form.
    // Public like the rest of the cascade (used before login); POST because
    // it carries the farmer's coordinates. Nearest-centroid matching — see
    // App\Support\Geo for why this is a suggestion, not a boundary lookup.
    Route::post('/barangays/nearest', [BarangayController::class, 'nearest'])
        ->middleware('throttle:30,1')
        ->name('api.barangays.nearest');
    Route::post('/barangays/{barangay}/puroks/nearest', [BarangayController::class, 'nearestPurok'])
        ->middleware('throttle:60,1')
        ->name('api.barangays.puroks.nearest');

    // Address → coordinates for the public registration form's pin preview.
    // Cached server-side and throttled — it proxies Nominatim, which forbids
    // heavy use. Public because the register page has no session yet.
    Route::get('/geocode', [BeneficiaryController::class, 'geocode'])
        ->middleware('throttle:30,1')
        ->name('api.geocode');

    // Landing page map — aggregated program statistics only (per-barangay
    // counts on fixed barangay centroids and program totals). No names, no
    // exact farm coordinates, no session required. Cached server-side.
    Route::get('/public/map-summary', [PublicMapController::class, 'summary'])
        ->middleware('throttle:30,1')
        ->name('api.public.map-summary');

    // Public transparency dashboard — aggregate program statistics only
    // (city totals, per-barangay counts, a monthly reach trend, vaccination
    // compliance). No names, no household/animal ids, no farm coordinates.
    // Session-free like the map summary; cached server-side so anonymous
    // traffic cannot become a query amplifier.
    Route::get('/public/transparency', [PublicTransparencyController::class, 'index'])
        ->middleware('throttle:30,1')
        ->name('api.public.transparency');
});

// Authenticated routes
Route::prefix('v1')->middleware('auth:sanctum')->group(function (): void {
    Route::get('/user', [AuthController::class, 'user'])->name('api.user');
    Route::post('/logout', [AuthController::class, 'logout'])->name('api.logout');
    Route::post('/logout-all', [AuthController::class, 'logoutAll'])->name('api.logout-all');

    // The authenticated user's own profile — no {id} anywhere: every route
    // is scoped to the caller by construction.
    Route::get('/profile', [ProfileController::class, 'show'])->name('api.profile.show');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('api.profile.update');
    Route::patch('/profile/password', [ProfileController::class, 'updatePassword'])
        ->middleware('throttle:6,1')
        ->name('api.profile.password');
    Route::post('/profile/avatar', [ProfileController::class, 'storeAvatar'])
        ->name('api.profile.avatar.store');
    Route::delete('/profile/avatar', [ProfileController::class, 'destroyAvatar'])
        ->name('api.profile.avatar.destroy');

    Route::apiResource('projects', ProjectController::class);

    // Beneficiaries & livestock monitoring
    Route::apiResource('beneficiaries', BeneficiaryController::class);
    Route::get('beneficiaries/{id}/lineage', [DispersalEventController::class, 'lineage'])
        ->name('api.beneficiaries.lineage');

    // The month/year tab list for the monitoring table — must be declared
    // BEFORE the apiResource, whose {monitoring_record} binding would
    // otherwise swallow "months" as a record id (same pattern as
    // health-records/options below).
    Route::get('monitoring-records/months', [MonitoringRecordController::class, 'months'])
        ->name('api.monitoring-records.months');

    Route::apiResource('monitoring-records', MonitoringRecordController::class);

    // Admin accepts a registration-created monitoring record (starts the
    // midnight countdown). Declared after the apiResource so its explicit
    // path wins over the {monitoring_record} binding, same as the pattern
    // used for field-visit photo routes.
    Route::patch('monitoring-records/{id}/accept', [MonitoringRecordController::class, 'accept'])
        ->name('api.monitoring-records.accept');

    // Clinical health records (veterinarian-authored).
    //
    // The options route MUST come before the apiResource: apiResource registers
    // `health-records/{health_record}`, which would otherwise swallow
    // "options" as a record id and fail to bind.
    Route::get('health-records/options', [HealthRecordController::class, 'options'])
        ->name('api.health-records.options');
    Route::apiResource('health-records', HealthRecordController::class);

    // Freeform veterinary case notes (veterinarian-authored).
    Route::apiResource('case-notes', CaseNoteController::class);

    // Rule-Based Health Concern Hints — the active rule table the case-note /
    // health-record forms match against, CLIENT-side. Read-only here; the
    // admin editor's CRUD lives under the admin group below.
    Route::get('symptom-rules', [SymptomRuleController::class, 'active'])
        ->name('api.symptom-rules');

    // Technician field visits — the trip, with an optional on-site GPS fix.
    // The options route is declared first so apiResource cannot bind
    // "options" as a visit id.
    Route::get('field-visits/options', [FieldVisitController::class, 'options'])
        ->name('api.field-visits.options');
    Route::apiResource('field-visits', FieldVisitController::class);

    // Geotagged visit photos — declared AFTER the apiResource so the explicit
    // paths win over the resource's {field_visit} binding. POST attaches (and
    // a retake replaces) the composited image + structured metadata; DELETE
    // removes it. Photo routes must come after apiResource, same pattern as
    // health-records/options above.
    Route::post('field-visits/{id}/photo', [FieldVisitController::class, 'storePhoto'])
        ->name('api.field-visits.photos.store');
    Route::delete('field-visits/{id}/photo', [FieldVisitController::class, 'destroyPhoto'])
        ->name('api.field-visits.photos.destroy');

    // Vaccination schedule — derived, read-only, role-scoped.
    Route::get('vaccination-schedule', [VaccinationScheduleController::class, 'index'])
        ->name('api.vaccination-schedule');

    // Animal health rollup — derived, read-only, role-scoped.
    Route::get('animal-health', [AnimalHealthController::class, 'index'])
        ->name('api.animal-health');

    // Notification feed — derived alerts + the caller's stored event
    // notifications, always their own. unread-count backs the bell badge
    // (cheap enough to poll); read-all marks every stored event read.
    Route::get('notifications', [NotificationController::class, 'index'])
        ->name('api.notifications');
    Route::get('notifications/unread-count', [NotificationController::class, 'unreadCount'])
        ->name('api.notifications.unread-count');
    Route::post('notifications/read-all', [NotificationController::class, 'markAllRead'])
        ->name('api.notifications.read-all');

    // Global header search — read-only, role-scoped to the caller's own rows.
    Route::get('search', [SearchController::class, 'index'])
        ->middleware('throttle:60,1')
        ->name('api.search');

    // Livestock pass-on / re-dispersal chain
    Route::apiResource('dispersal-events', DispersalEventController::class);

    // Admin: account roles and technician assignment
    Route::prefix('admin')->middleware(EnsureUserIsAdmin::class)->group(function (): void {
        Route::get('/users', [AdminController::class, 'users'])->name('api.admin.users');
        Route::patch('/users/{id}/role', [AdminController::class, 'assignRole'])->name('api.admin.users.assign-role');
        Route::get('/beneficiaries', [AdminController::class, 'beneficiaries'])->name('api.admin.beneficiaries');
        Route::patch('/beneficiaries/{id}/assign-technician', [AdminController::class, 'assignTechnician'])->name('api.admin.beneficiaries.assign-technician');
        Route::patch('/beneficiaries/bulk-assign-technician', [AdminController::class, 'bulkAssignTechnician'])
            ->name('api.admin.beneficiaries.bulk-assign-technician');

        // Livestock monitoring report workbook (CVO Excel format)
        Route::post('/monitoring-records/import', [AdminController::class, 'importMonitoringExcel'])
            ->name('api.admin.monitoring.import');
        Route::get('/monitoring-records/export', [AdminController::class, 'exportMonitoringExcel'])
            ->name('api.admin.monitoring.export');

        // City-wide program report — aggregated, read-only.
        Route::get('/report', [ReportController::class, 'index'])
            ->name('api.admin.report');

        // System settings — office contact profile (writable), program
        // configuration (read-only).
        Route::get('/settings', [SettingsController::class, 'index'])
            ->name('api.admin.settings');
        Route::patch('/settings', [SettingsController::class, 'update'])
            ->name('api.admin.settings.update');

        // Health concern hint rules — the admin-editable half of the
        // Rule-Based Health Concern Hints (the read-only half is
        // `GET /symptom-rules` above).
        Route::get('/symptom-rules', [SymptomRuleController::class, 'index'])
            ->name('api.admin.symptom-rules');
        Route::post('/symptom-rules', [SymptomRuleController::class, 'store'])
            ->name('api.admin.symptom-rules.store');
        Route::patch('/symptom-rules/{symptomRule}', [SymptomRuleController::class, 'update'])
            ->name('api.admin.symptom-rules.update');
        Route::delete('/symptom-rules/{symptomRule}', [SymptomRuleController::class, 'destroy'])
            ->name('api.admin.symptom-rules.destroy');

        // Security audit trail (item 7) — read-only, admin-only. The table
        // endpoint is paginated and filterable; the actions endpoint feeds
        // the UI's filter dropdown from the canonical vocabulary.
        Route::get('/activity-logs', [ActivityLogController::class, 'index'])
            ->name('api.admin.activity-logs');
        Route::get('/activity-logs/actions', [ActivityLogController::class, 'actions'])
            ->name('api.admin.activity-logs.actions');
    });
});
