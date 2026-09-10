# CVO API (Laravel Backend)

RESTful API built with Laravel 13 + Sanctum, MySQL, and versioned routes under `/api/v1`.

## Requirements

- PHP >= 8.3 with `pdo_mysql` (and `pdo_sqlite` for the test suite)
- Composer
- MySQL / MariaDB (XAMPP works fine)

## Setup

```bash
composer install
cp .env.example .env   # then adjust values below (a ready .env is already provided)
php artisan key:generate
php artisan migrate --seed
```

### Environment variables (key values)

```env
APP_URL=http://localhost:8000
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=cvo_api
DB_USERNAME=root
DB_PASSWORD=

# SPA auth — must match the frontend origin exactly (scheme + host + port)
SANCTUM_STATEFUL_DOMAINS=localhost:5173,127.0.0.1:5173
# Host-only session cookie; null is correct for local dev on both
# localhost and 127.0.0.1
SESSION_DOMAIN=null

# CORS — comma-separated list of allowed frontend origins (no wildcards in production)
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

## Run

```bash
php artisan serve            # http://localhost:8000
```

## Run tests

```bash
php artisan test             # uses sqlite in-memory automatically
```

## API endpoints

| Method | URI                    | Auth           | Description                          |
|--------|------------------------|----------------|--------------------------------------|
| POST   | `/api/v1/register`     | -              | Register + start session             |
| POST   | `/api/v1/login`        | -              | Login (cookie session for SPA)       |
| POST   | `/api/v1/token-login`  | -              | Login (returns bearer token, mobile) |
| GET    | `/api/v1/user`         | session/token  | Current user                         |
| POST   | `/api/v1/logout`       | session/token  | Logout (revokes token or session)    |
| GET    | `/api/v1/projects`     | session/token  | List user's projects (paginated)     |
| POST   | `/api/v1/projects`     | session/token  | Create project                       |
| GET    | `/api/v1/projects/{id}`| session/token  | Show project (owner only)            |
| PUT    | `/api/v1/projects/{id}`| session/token  | Update project (owner only)          |
| DELETE | `/api/v1/projects/{id}`| session/token  | Delete project (owner only)          |

SPA clients must first hit `GET /sanctum/csrf-cookie` before `login`/`register`.

## Structure notes

- Controllers stay thin; logic lives in `app/Services/*`.
- Validation via Form Requests in `app/Http/Requests`.
- JSON shape via API Resources in `app/Http/Resources`.
- Authorization via `app/Policies/ProjectPolicy`.
- Auth endpoints are throttled (6/min).
