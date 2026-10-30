<?php

use App\Http\Controllers\ActivityLogController;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\AnalyticsController;
use App\Http\Controllers\AnimalDispersalController;
use App\Http\Controllers\AnimalHealthController;
use App\Http\Controllers\AnimalTypeController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BarangayController;
use App\Http\Controllers\BeneficiaryController;
use App\Http\Controllers\CaseNoteController;
use App\Http\Controllers\DispersalEventController;
use App\Http\Controllers\DispersalMapController;
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
use App\Http\Controllers\RolePermissionController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\SettingsController;
use App\Http\Controllers\SiteController;
use App\Http\Controllers\SyncConflictController;
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

// Authentication (rate limited to 6 attempts per minute).
//
// There is no public registration endpoint: accounts are staff-only and
// created by an administrator (see the /admin/users routes), and beneficiaries
// are program records the admin enters on the Beneficiaries screen.
// The trailing argument on each throttle below is the LIMITER PREFIX. Laravel
// keys a numeric throttle on sha1(domain|ip) alone — every `throttle:X,1`
// without a prefix shares ONE counter per IP, so six hits to the public
// /site endpoint would starve the login budget (and vice versa). A distinct
// prefix per budget keeps them independent.
Route::prefix('v1')->middleware('throttle:6,1,auth')->group(function (): void {
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
});

/*
|--------------------------------------------------------------------------
| Public reference & aggregate routes
|--------------------------------------------------------------------------
|
| Session-free: the registration form's barangay cascade, the geocode proxy
| and the public dashboards are all used BEFORE login. They deliberately sit
| in their own group rather than the auth group above: that group is capped
| at 6 requests/minute per IP, so nesting these under it silently throttled
| the landing page and the address cascade to the same tiny login budget
| (the per-route 30/60-per-minute limits never took effect — the outer
| 6/min always tripped first). Each route carries the budget it intends.
|
*/
Route::prefix('v1')->group(function (): void {
    // Location reference data for the public forms — the barangay → purok
    // cascade the Beneficiaries screen (and any pre-login form) uses.
    // Read-only and session-free: these are reference tables, not user
    // data, so they need no auth. Ordered by id (the config seed order) so
    // the dropdown reads as a stable list.
    Route::get('/barangays', [BarangayController::class, 'index'])
        ->middleware('throttle:60,1,barangays')
        ->name('api.barangays');
    Route::get('/barangays/{barangay}/puroks', [BarangayController::class, 'puroks'])
        ->middleware('throttle:60,1,barangays')
        ->name('api.barangays.puroks');

    // GPS/pin → barangay/purok auto-detect. Public like the rest of the
    // cascade (the admin form opens it while its first fetches still sit in
    // the throttle budget); POST because it carries coordinates.
    // Nearest-centroid matching — see App\Support\Geo for why this is a
    // suggestion, not a boundary lookup.
    Route::post('/barangays/nearest', [BarangayController::class, 'nearest'])
        ->middleware('throttle:30,1,barangays-nearest')
        ->name('api.barangays.nearest');
    Route::post('/barangays/{barangay}/puroks/nearest', [BarangayController::class, 'nearestPurok'])
        ->middleware('throttle:60,1,barangays-nearest')
        ->name('api.barangays.puroks.nearest');

    // Address → coordinates for the pin preview on the admin Beneficiaries
    // form. Cached server-side and throttled — it proxies Nominatim, which
    // forbids heavy use. Public so the address cascade is also reachable
    // before the first fetch settles.
    Route::get('/geocode', [BeneficiaryController::class, 'geocode'])
        ->middleware('throttle:30,1,geocode')
        ->name('api.geocode');

    // Landing page map — aggregated program statistics only (per-barangay
    // counts on fixed barangay centroids and program totals). No names, no
    // exact farm coordinates, no session required. Cached server-side.
    Route::get('/public/map-summary', [PublicMapController::class, 'summary'])
        ->middleware('throttle:30,1,map-summary')
        ->name('api.public.map-summary');

    // Public site metadata — the office contact details an administrator edits
    // in System Settings, plus the SPA's own inactivity window. Session-free
    // because every page that renders them (landing, Support, the
    // password-reset note) is used before login.
    Route::get('/site', [SiteController::class, 'show'])
        ->middleware('throttle:60,1,site')
        ->name('api.site');

    // Public transparency dashboard — aggregate program statistics only
    // (city totals, per-barangay counts, a monthly reach trend, vaccination
    // compliance). No names, no household/animal ids, no farm coordinates.
    // Session-free like the map summary; cached server-side so anonymous
    // traffic cannot become a query amplifier.
    Route::get('/public/transparency', [PublicTransparencyController::class, 'index'])
        ->middleware('throttle:30,1,transparency')
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
        ->middleware('throttle:6,1,password')
        ->name('api.profile.password');
    Route::post('/profile/avatar', [ProfileController::class, 'storeAvatar'])
        ->name('api.profile.avatar.store');
    Route::delete('/profile/avatar', [ProfileController::class, 'destroyAvatar'])
        ->name('api.profile.avatar.destroy');

    Route::apiResource('projects', ProjectController::class);

    // The animal master list (Animal Type → Classification), served grouped by
    // main category. Every role that records or views an animal reads it —
    // the registration cascade, the monitoring filter and the settings
    // manager all consume this one response. Writes are admin-only, below.
    Route::get('animal-types', [AnimalTypeController::class, 'index'])
        ->name('api.animal-types');

    // Beneficiaries & livestock monitoring
    Route::apiResource('beneficiaries', BeneficiaryController::class);
    Route::post('beneficiaries/bulk-delete', [BeneficiaryController::class, 'bulkDestroy'])
        ->name('api.beneficiaries.bulk-delete');
    Route::get('beneficiaries/{id}/lineage', [DispersalEventController::class, 'lineage'])
        ->name('api.beneficiaries.lineage');

    // One animal's chronological location history — origin → field visits →
    // current pin — behind the map's per-beneficiary flight path. Same
    // role scoping as show(); the trailing segment keeps it clear of
    // apiResource's beneficiaries/{beneficiary} binding, exactly like the
    // lineage route above.
    Route::get('beneficiaries/{id}/path', [BeneficiaryController::class, 'path'])
        ->name('api.beneficiaries.path');

    // The month/year tab list for the monitoring table — must be declared
    // BEFORE the apiResource, whose {monitoring_record} binding would
    // otherwise swallow "months" as a record id (same pattern as
    // health-records/options below).
    Route::get('monitoring-records/months', [MonitoringRecordController::class, 'months'])
        ->name('api.monitoring-records.months');

    // The distinct animal types present in the data — the animal-type filter's
    // option list. Declared before the apiResource for the same reason as
    // `months`: otherwise {monitoring_record} would swallow "animal-types".
    Route::get('monitoring-records/animal-types', [MonitoringRecordController::class, 'animalTypes'])
        ->name('api.monitoring-records.animal-types');

    Route::apiResource('monitoring-records', MonitoringRecordController::class);
    Route::post('monitoring-records/bulk-delete', [MonitoringRecordController::class, 'bulkDestroy'])
        ->name('api.monitoring-records.bulk-delete');

    // Admin flips the dispersal's MOA status (per-beneficiary) from the
    // monitoring table's inline toggle. Declared after the apiResource so
    // the explicit path wins, and authorized by
    // MonitoringRecordPolicy::setMoa inside the controller.
    Route::patch('monitoring-records/{id}/moa', [MonitoringRecordController::class, 'setMoa'])
        ->name('api.monitoring-records.moa');

    // Clinical health records (veterinarian-authored).
    //
    // The options route MUST come before the apiResource: apiResource registers
    // `health-records/{health_record}`, which would otherwise swallow
    // "options" as a record id and fail to bind.
    Route::get('health-records/options', [HealthRecordController::class, 'options'])
        ->name('api.health-records.options');
    Route::apiResource('health-records', HealthRecordController::class);
    Route::post('health-records/bulk-delete', [HealthRecordController::class, 'bulkDestroy'])
        ->name('api.health-records.bulk-delete');

    // Freeform veterinary case notes (veterinarian-authored).
    Route::apiResource('case-notes', CaseNoteController::class);
    Route::post('case-notes/bulk-delete', [CaseNoteController::class, 'bulkDestroy'])
        ->name('api.case-notes.bulk-delete');

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
    Route::post('field-visits/bulk-delete', [FieldVisitController::class, 'bulkDestroy'])
        ->name('api.field-visits.bulk-delete');

    // Geotagged visit photos — declared AFTER the apiResource so the explicit
    // paths win over the resource's {field_visit} binding. POST attaches (and
    // a retake replaces) the composited image + structured metadata; DELETE
    // removes it. Photo routes must come after apiResource, same pattern as
    // health-records/options above.
    Route::post('field-visits/{id}/photo', [FieldVisitController::class, 'storePhoto'])
        ->name('api.field-visits.photos.store');
    Route::delete('field-visits/{id}/photo', [FieldVisitController::class, 'destroyPhoto'])
        ->name('api.field-visits.photos.destroy');

    // The technician's justification for an off-site verdict (Feature 1).
    // Declared after the apiResource so the explicit path wins over
    // {field_visit} binding, same pattern as the photo routes above.
    Route::patch('field-visits/{id}/verification-note', [FieldVisitController::class, 'verificationNote'])
        ->whereNumber('id')
        ->name('api.field-visits.verification-note');

    // Admin: adopt a visit's captured fix as the household's registered
    // pin (Feature 1) — for beneficiaries that have no geotag, including
    // rows created by the Excel import. Audited through the Beneficiary's
    // own diff row; the write itself is gated by beneficiaries.update.
    Route::patch('beneficiaries/{id}/location', [BeneficiaryController::class, 'setLocation'])
        ->whereNumber('id')
        ->name('api.beneficiaries.set-location');

    // Vaccination schedule — derived, read-only, role-scoped.
    Route::get('vaccination-schedule', [VaccinationScheduleController::class, 'index'])
        ->name('api.vaccination-schedule');

    // Animal health rollup — derived, read-only, role-scoped.
    Route::get('animal-health', [AnimalHealthController::class, 'index'])
        ->name('api.animal-health');

    // Notification feed — derived alerts + the caller's stored event
    // notifications, always their own. unread-count backs the bell badge
    // (cheap enough to poll); read-all marks every stored event read, while
    // {id}/read marks the one the reader just opened.
    Route::get('notifications', [NotificationController::class, 'index'])
        ->name('api.notifications');
    Route::get('notifications/unread-count', [NotificationController::class, 'unreadCount'])
        ->name('api.notifications.unread-count');
    Route::post('notifications/read-all', [NotificationController::class, 'markAllRead'])
        ->name('api.notifications.read-all');
    Route::post('notifications/{id}/read', [NotificationController::class, 'markRead'])
        ->whereNumber('id')
        ->name('api.notifications.read');

    // Global header search — read-only, role-scoped to the caller's own rows.
    Route::get('search', [SearchController::class, 'index'])
        ->middleware('throttle:60,1,search')
        ->name('api.search');

    // Offline sync conflicts — the client reports the technician's decision
    // (last-write-wins overwrite, or kept the newer server version) so a
    // conflict is auditable rather than silent. Always stamped with the
    // caller; there is no {id} to spoof.
    Route::post('sync/conflicts', [SyncConflictController::class, 'store'])
        ->name('api.sync.conflicts.store');

    // Livestock pass-on / re-dispersal chain (beneficiary-centric)
    Route::apiResource('dispersal-events', DispersalEventController::class);

    // The ANIMAL ownership chain — one animal whose owner changes over time,
    // and the single source the flight path is drawn from. Gated per
    // capability; row scoping (a technician sees only their assigned
    // households) is enforced in AnimalDispersalService's query layer.
    //
    // Note the void path is `ownership-events/{id}/void`, NOT
    // `dispersal-events/{id}/void`: the latter would collide with the
    // beneficiary-centric resource above and put two different tables behind
    // one URL prefix.
    Route::post('dispersals', [AnimalDispersalController::class, 'disperse'])
        ->middleware('permission:manage_dispersal')->name('api.dispersals.store');
    Route::post('animals/{animal}/redispersals', [AnimalDispersalController::class, 'redisperse'])
        ->middleware('permission:manage_redispersal')->name('api.animals.redispersals.store');
    Route::post('animals/{animal}/returns', [AnimalDispersalController::class, 'returnToCvo'])
        ->middleware('permission:manage_redispersal')->name('api.animals.returns.store');
    Route::post('animals/{animal}/pass-ons', [AnimalDispersalController::class, 'passOn'])
        ->middleware('permission:manage_dispersal')->name('api.animals.pass-ons.store');
    Route::post('ownership-events/{event}/void', [AnimalDispersalController::class, 'voidEvent'])
        ->middleware('permission:void_dispersal_event')->name('api.ownership-events.void');

    // Which animals a household currently holds — the UI resolves the animal
    // to act on from the beneficiary row it already has.
    Route::get('beneficiaries/{id}/animals', [AnimalDispersalController::class, 'beneficiaryAnimals'])
        ->middleware('permission:view_flight_path')->name('api.beneficiaries.animals');

    Route::get('animals/{animal}/ownership-chain', [AnimalDispersalController::class, 'ownershipChain'])
        ->middleware('permission:view_flight_path')->name('api.animals.ownership-chain');
    Route::get('animals/{animal}/flight-path', [AnimalDispersalController::class, 'flightPath'])
        ->middleware('permission:view_flight_path')->name('api.animals.flight-path');

    // Barangay dispersal analytics — the Reports "Barangay dispersal" tab
    // and the dashboard widget. Aggregated read-only answers (one row per
    // barangay, one row per flow); the database computes them, the SPA
    // renders them. Gated per capability by the role_permissions matrix;
    // row scoping (a technician sees only their assigned households' events)
    // is enforced in BarangayDispersalAnalyticsService's query layer.
    // Deliberately NOT under /admin: doctors and technicians hold the
    // analytics capability without the rest of the admin module.
    Route::get('analytics/barangay-dispersal', [AnalyticsController::class, 'barangayDispersal'])
        ->middleware('permission:view_analytics')->name('api.analytics.barangay-dispersal');
    Route::get('analytics/barangay-flows', [AnalyticsController::class, 'barangayFlows'])
        ->middleware('permission:view_analytics')->name('api.analytics.barangay-flows');
    // Declared before nothing conflicts, but kept grouped with its siblings;
    // the spreadsheet carries the barangay table + flow matrix + filter
    // summary behind the same filters as the screen.
    Route::get('analytics/barangay-dispersal/export', [AnalyticsController::class, 'exportBarangayDispersal'])
        ->middleware('permission:view_analytics')->name('api.analytics.barangay-dispersal.export');

    // The dispersal map's dated snapshot — the pins AND the barangay polygon
    // counts for one date, from one query snapshot, plus the list of dates
    // that have records for the date selector. Gated per capability by the
    // role_permissions matrix (the same view_flight_path gate behind every
    // ownership chain); row scoping (a technician sees only events touching
    // their assigned households) is enforced in DispersalMapService's query
    // layer, never in the client.
    Route::get('map/dates', [DispersalMapController::class, 'dates'])
        ->middleware('permission:view_flight_path')->name('api.map.dates');
    Route::get('map/pins', [DispersalMapController::class, 'pins'])
        ->middleware('permission:view_flight_path')->name('api.map.pins');

    // Admin: the /admin module, gated PER CAPABILITY by the role_permissions
    // matrix (EnsurePermission) instead of one role check. With the shipped
    // seed only `admin` holds these capabilities, so day-one behaviour is
    // unchanged — but a grant made on the Roles & Permissions screen now
    // actually opens the door (e.g. view_reports for a doctor), and a revoked
    // grant closes it, per endpoint. Each FormRequest re-checks the same
    // capability as the second gate.
    Route::prefix('admin')->group(function (): void {
        Route::get('/users', [AdminController::class, 'users'])
            ->middleware('permission:manage_users')->name('api.admin.users');
        Route::post('/users', [AdminController::class, 'storeUser'])
            ->middleware('permission:manage_users')->name('api.admin.users.store');
        // Declared before the {id} PATCH below only for readability — the two
        // paths differ in segment count, so neither can shadow the other.
        Route::patch('/users/{id}/role', [AdminController::class, 'assignRole'])
            ->middleware('permission:manage_users')->name('api.admin.users.assign-role');
        Route::patch('/users/{id}', [AdminController::class, 'updateUser'])
            ->middleware('permission:manage_users')->name('api.admin.users.update');
        // Deactivation is the soft delete: the account stops signing in but
        // stays resolvable for the rows that reference it (authored records,
        // audit trail). Reactivate is the way back.
        Route::delete('/users/{id}', [AdminController::class, 'deactivateUser'])
            ->middleware('permission:manage_users')->name('api.admin.users.deactivate');
        Route::post('/users/{id}/reactivate', [AdminController::class, 'reactivateUser'])
            ->middleware('permission:manage_users')->name('api.admin.users.reactivate');
        Route::get('/users/{id}/activity', [AdminController::class, 'userActivity'])
            ->middleware('permission:manage_users')->name('api.admin.users.activity');
        Route::post('/users/bulk-deactivate', [AdminController::class, 'bulkDeactivateUsers'])
            ->middleware('permission:manage_users')->name('api.admin.users.bulk-deactivate');
        Route::get('/beneficiaries', [AdminController::class, 'beneficiaries'])
            ->middleware('permission:assign_technicians')->name('api.admin.beneficiaries');
        Route::patch('/beneficiaries/{id}/assign-technician', [AdminController::class, 'assignTechnician'])
            ->middleware('permission:assign_technicians')->name('api.admin.beneficiaries.assign-technician');
        Route::patch('/beneficiaries/bulk-assign-technician', [AdminController::class, 'bulkAssignTechnician'])
            ->middleware('permission:assign_technicians')
            ->name('api.admin.beneficiaries.bulk-assign-technician');

        // Livestock monitoring report workbook (CVO Excel format)
        Route::post('/monitoring-records/import', [AdminController::class, 'importMonitoringExcel'])
            ->middleware('permission:import_monitoring_records')->name('api.admin.monitoring.import');
        Route::get('/monitoring-records/export', [AdminController::class, 'exportMonitoringExcel'])
            ->middleware('permission:export_monitoring_records')->name('api.admin.monitoring.export');

        // The Reports screen's five charts — one dedicated aggregation
        // endpoint each (ReportChartService): the database computes the
        // aggregate, the SPA renders it. Filters follow each chart's
        // semantics (barangay / animal type / month / date range).
        Route::get('/report/charts/dispersal-trend', [ReportController::class, 'dispersalTrend'])
            ->middleware('permission:view_reports')->name('api.admin.report.charts.dispersal-trend');
        Route::get('/report/charts/animals-by-barangay', [ReportController::class, 'animalsByBarangay'])
            ->middleware('permission:view_reports')->name('api.admin.report.charts.animals-by-barangay');
        Route::get('/report/charts/vaccination-compliance', [ReportController::class, 'vaccinationCompliance'])
            ->middleware('permission:view_reports')->name('api.admin.report.charts.vaccination-compliance');
        Route::get('/report/charts/animal-type-distribution', [ReportController::class, 'animalTypeDistribution'])
            ->middleware('permission:view_reports')->name('api.admin.report.charts.animal-type-distribution');
        Route::get('/report/charts/technician-workload', [ReportController::class, 'technicianWorkload'])
            ->middleware('permission:view_reports')->name('api.admin.report.charts.technician-workload');

        // City-wide program report — aggregated, read-only.
        Route::get('/report', [ReportController::class, 'index'])
            ->middleware('permission:view_reports')->name('api.admin.report');
        // The same report as a spreadsheet, scoped by the same filters, so the
        // figures behind the charts are not trapped on screen.
        Route::get('/report/export', [ReportController::class, 'export'])
            ->middleware('permission:view_reports')->name('api.admin.report.export');

        // Off-site / needs-review counts behind the Reports screen's
        // verification card (Feature 1).
        Route::get('/report/verification', [ReportController::class, 'verificationSummary'])
            ->middleware('permission:view_reports')->name('api.admin.report.verification');

        // The printable report built on the office's own Excel template — the
        // CVO cover sheet + signature block, filled with the dispersal roster
        // for the chosen filters. POST: the editable report name and filters
        // travel in the body. Same view_reports gate as the report above.
        Route::post('/report/template-export', [ReportController::class, 'exportFromTemplate'])
            ->middleware('permission:view_reports')->name('api.admin.report.template-export');

        // The capability matrix itself. Guarded by manage_roles — the one
        // permission that can edit permissions. The controller refuses (422)
        // any change that would leave no active account holding it.
        Route::get('/roles/permissions', [RolePermissionController::class, 'index'])
            ->middleware('permission:manage_roles')->name('api.admin.roles.permissions');
        Route::patch('/roles/{role}/permissions', [RolePermissionController::class, 'update'])
            ->middleware('permission:manage_roles')->name('api.admin.roles.permissions.update');

        // System settings — office contact profile, alert thresholds, animal
        // types, notification preferences (writable); session ceilings and
        // form vocabularies (read-only).
        Route::get('/settings', [SettingsController::class, 'index'])
            ->middleware('permission:manage_settings')->name('api.admin.settings');
        Route::patch('/settings', [SettingsController::class, 'update'])
            ->middleware('permission:manage_settings')->name('api.admin.settings.update');

        // Reference data management — puroks/sitios (add / rename / delete
        // when unused) and barangays (add / re-center; rename is deliberately
        // impossible, see BarangayController). The public read cascade above
        // serves whatever is recorded here, so the registration form follows
        // without a redeploy.
        Route::post('/barangays', [BarangayController::class, 'store'])
            ->middleware('permission:manage_reference_data')->name('api.admin.barangays.store');
        Route::patch('/barangays/{barangay}', [BarangayController::class, 'update'])
            ->middleware('permission:manage_reference_data')->name('api.admin.barangays.update');
        Route::post('/barangays/{barangay}/puroks', [BarangayController::class, 'storePurok'])
            ->middleware('permission:manage_reference_data')->name('api.admin.barangays.puroks.store');
        Route::patch('/puroks/{purok}', [BarangayController::class, 'updatePurok'])
            ->middleware('permission:manage_reference_data')->name('api.admin.puroks.update');
        Route::delete('/puroks/{purok}', [BarangayController::class, 'destroyPurok'])
            ->middleware('permission:manage_reference_data')->name('api.admin.puroks.destroy');

        // Animal master list (Animal Type → Classification). Real CRUD rather
        // than a fixed seed: the office must be able to add a species the
        // shipped list did not anticipate. Deletion is refused while animals
        // still reference the entry (see AnimalTypeController).
        Route::post('/animal-types', [AnimalTypeController::class, 'store'])
            ->middleware('permission:manage_reference_data')->name('api.admin.animal-types.store');
        Route::patch('/animal-types/{animalType}', [AnimalTypeController::class, 'update'])
            ->middleware('permission:manage_reference_data')->name('api.admin.animal-types.update');
        Route::delete('/animal-types/{animalType}', [AnimalTypeController::class, 'destroy'])
            ->middleware('permission:manage_reference_data')->name('api.admin.animal-types.destroy');
        Route::post('/animal-types/{animalType}/classifications', [AnimalTypeController::class, 'storeClassification'])
            ->middleware('permission:manage_reference_data')->name('api.admin.animal-types.classifications.store');
        Route::patch('/animal-classifications/{animalClassification}', [AnimalTypeController::class, 'updateClassification'])
            ->middleware('permission:manage_reference_data')->name('api.admin.animal-classifications.update');
        Route::delete('/animal-classifications/{animalClassification}', [AnimalTypeController::class, 'destroyClassification'])
            ->middleware('permission:manage_reference_data')->name('api.admin.animal-classifications.destroy');

        // Health concern hint rules — the admin-editable half of the
        // Rule-Based Health Concern Hints (the read-only half is
        // `GET /symptom-rules` above). Lives under manage_settings because
        // System Settings is the screen that manages them.
        Route::get('/symptom-rules', [SymptomRuleController::class, 'index'])
            ->middleware('permission:manage_settings')->name('api.admin.symptom-rules');
        Route::post('/symptom-rules', [SymptomRuleController::class, 'store'])
            ->middleware('permission:manage_settings')->name('api.admin.symptom-rules.store');
        Route::patch('/symptom-rules/{symptomRule}', [SymptomRuleController::class, 'update'])
            ->middleware('permission:manage_settings')->name('api.admin.symptom-rules.update');
        Route::delete('/symptom-rules/{symptomRule}', [SymptomRuleController::class, 'destroy'])
            ->middleware('permission:manage_settings')->name('api.admin.symptom-rules.destroy');

        // Security audit trail (item 7) — read-only. The table
        // endpoint is paginated and filterable; the actions endpoint feeds
        // the UI's filter dropdown from the canonical vocabulary.
        Route::get('/activity-logs', [ActivityLogController::class, 'index'])
            ->middleware('permission:view_activity_logs')->name('api.admin.activity-logs');
        Route::get('/activity-logs/actions', [ActivityLogController::class, 'actions'])
            ->middleware('permission:view_activity_logs')->name('api.admin.activity-logs.actions');

        // Offline sync conflicts — the admin audit view of conflicts logged
        // by field staff (reuses the audit-trail permission; it is the same
        // kind of "what happened" record).
        Route::get('/sync-conflicts', [SyncConflictController::class, 'index'])
            ->middleware('permission:view_activity_logs')->name('api.admin.sync-conflicts');
    });
});
