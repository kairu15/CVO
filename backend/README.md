# CVO API — Laravel Backend

REST API for the CVO Livestock and Poultry Dispersal Tracking System. Laravel 13 with Sanctum, MySQL, and versioned routes under `/api/v1`.

The API is the single source of truth for the web SPA and the Expo mobile app. It owns authentication, authorization, business rules, file handling, and every aggregation the dashboards and reports display.

## Requirements

- PHP 8.4+ with `pdo_mysql` (the lock file pins Symfony 8.1, which requires PHP >= 8.4.1)
- `pdo_sqlite` for the test suite
- Composer
- MySQL 8 (or MariaDB 10.6+)

## Setup

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate --seed
php artisan storage:link
php artisan serve --port=8005
```

`--seed` creates the two staff accounts plus the barangay and symptom-rule reference data. Passwords come from `SEED_ACCOUNT_PASSWORD`; local/testing fall back to `password`. Seeding is never automatic in the Docker production stack.

### Key environment values

```env
APP_URL=http://localhost:8005
FRONTEND_URL=http://localhost:5173

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=cvo_api
DB_USERNAME=root
DB_PASSWORD=

# SPA auth — the browser origin, host:port with no scheme
SANCTUM_STATEFUL_DOMAINS=localhost:5173,127.0.0.1:5173
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
SESSION_DOMAIN=null
```

Mail settings are required for staff verification links and password-reset codes. For local development without SMTP, set `MAIL_MAILER=log` and read the code from `storage/logs/laravel.log`.

## Authentication

| Client | Flow |
|---|---|
| Web SPA | `GET /sanctum/csrf-cookie`, then `POST /api/v1/login`. The session cookie and `X-XSRF-TOKEN` header authenticate later requests. |
| Mobile | `POST /api/v1/token-login` returns a bearer token. Send it as `Authorization: Bearer <token>`. |

There is **no registration endpoint**. Every account is staff, created by an administrator through `POST /api/v1/admin/users`. Beneficiaries are records, not logins.

Password recovery is a three-step public flow: `POST /api/v1/forgot-password`, `POST /api/v1/verify-reset-code`, then `POST /api/v1/reset-password`. The code is a six-digit OTP, stored hashed, expiring after ten minutes with five attempts. A successful reset revokes every session and token for the account.

New staff accounts must verify their email through `POST /api/v1/email/verify` before they can sign in. The token is hashed, single-use, and expires after `SECURITY_EMAIL_VERIFICATION_EXPIRY_HOURS`.

## Roles and authorization

The only roles are `admin` and `technician` (`App\Models\User::ROLES`, labelled by `App\Support\RoleCatalog`).

- Capabilities live in the `role_permissions` matrix and are enforced by the `permission:` middleware (`EnsurePermission`).
- Form Requests re-check the relevant capability, and policies scope individual records.
- Technicians see only the households assigned to them; that scoping is applied in the service query layer, not in the client.
- `manage_roles` can edit the matrix, but the controller refuses a change that would leave no active holder.

## Endpoint groups

| Group | Representative paths | Notes |
|---|---|---|
| Public reference | `/barangays`, `/barangays/nearest`, `/geocode`, `/site` | Session-free, individually throttled. |
| Public program data | `/public/map-summary`, `/public/transparency`, `/public/announcements`, `/public/documents`, `/public/contact` | Aggregates only; no identities or exact coordinates. |
| Authentication | `/login`, `/token-login`, `/logout`, `/forgot-password`, `/verify-reset-code`, `/reset-password`, `/email/verify` | Rate-limited. |
| Profile | `/profile`, `/profile/security`, `/profile/password`, `/profile/avatar`, `/profile/sessions/revoke-others` | Always scoped to the caller. |
| Beneficiaries | `/beneficiaries`, `/beneficiaries/{id}/lineage`, `/beneficiaries/{id}/path`, `/beneficiaries/{id}/animals`, `/beneficiaries/{id}/location` | CRUD plus bulk delete and location adoption. |
| Monitoring | `/monitoring-records`, `/monitoring-records/months`, `/monitoring-records/summary` | Livestock/poultry monitoring table. |
| Clinical | `/health-records`, `/case-notes`, `/vaccination-schedule`, `/vaccinations`, `/animal-health`, `/symptom-rules` | Technician-authored; `symptom-rules` is read-only here. |
| Field work | `/field-visits`, `/field-visits/visits-due`, `/technician/dashboard`, `/technician/visit-plans` | Visits, photos, verification notes, plans. |
| Dispersal | `/dispersals`, `/animals/{animal}/redispersals`, `/animals/{animal}/returns`, `/animals/{animal}/pass-ons`, `/ownership-events/{event}/void`, `/dispersal-events` | The animal ownership chain plus the legacy beneficiary-centric pass-on chain. |
| Map and analytics | `/map/dates`, `/map/pins`, `/analytics/barangay-dispersal`, `/analytics/barangay-flows` | Dated snapshots and barangay aggregates. |
| Notifications | `/notifications`, `/notifications/unread-count`, `/notifications/preferences` | Always the caller's own feed. |
| Admin | `/admin/users`, `/admin/technicians`, `/admin/beneficiaries`, `/admin/report`, `/admin/roles`, `/admin/settings`, `/admin/activity-logs`, `/admin/announcements`, `/admin/documents` | Each path carries its own capability. |

## Conventions

- Controllers stay thin; business logic and aggregation live in `app/Services/`.
- Validation and per-request authorization live in `app/Http/Requests/`.
- JSON shapes are defined by `app/Http/Resources/`.
- Record-level authorization lives in `app/Policies/`.
- Changes to auditable models are written to `activity_logs` through the `Auditable` trait and `AuditLogger`, including field-level diffs.
- Uploaded images are sanitized on write and served from the private disk through signed, expiring URLs (`App\Support\SecureMedia`).

The `projects` resource is leftover scaffolding from the Laravel starter and is not used by any CVO module.

## Tests

```bash
php artisan test
```

`phpunit.xml` forces an in-memory SQLite connection, so the suite never touches the development or production MySQL database. Factories in `database/factories/` build the test data.

## Scheduled work

`routes/console.php` schedules the smart-alert computation daily at 00:30 (Asia/Manila). It requires the host to run `php artisan schedule:run` every minute, or `php artisan schedule:work` in development. Run it manually with:

```bash
php artisan alerts:compute-smart
```

Other maintenance commands (backfills, ownership verification, coordinate backfills) are listed by `php artisan list`.
