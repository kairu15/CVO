# CVO — Full-Stack Monorepo

| Folder      | Stack                                             | Auth                                        |
|-------------|---------------------------------------------------|---------------------------------------------|
| `backend/`  | Laravel 13 API, MySQL, Sanctum                    | Cookie sessions (SPA) + Bearer tokens (mobile) |
| `frontend/` | React 19 + Vite 8, Tailwind CSS 4, React Router 7 | Sanctum cookie sessions                     |
| `mobile/`   | Expo (React Native), React Navigation             | Sanctum personal access tokens              |

## Quick start (local development)

### 0. Prerequisites

- PHP >= 8.3 + Composer (with `pdo_mysql` enabled)
- Node.js 20+
- MySQL / MariaDB running on **port 3306** (the XAMPP default). Installed as the
  auto-start Windows service `mysql` — it starts on boot; manage it via XAMPP
  Control Panel or `net start mysql` / `net stop mysql`

### 1. Database

Create the database (adjust credentials to yours):

```sql
CREATE DATABASE cvo_api CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Backend

```bash
cd backend
composer install
php artisan key:generate
php artisan migrate --seed
php artisan serve          # http://localhost:8000
```

Key `backend/.env` values:

```env
APP_URL=http://localhost:8000
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=cvo_api
DB_USERNAME=root
DB_PASSWORD=

# Must match the Vite dev origin exactly (scheme + host + port)
SANCTUM_STATEFUL_DOMAINS=localhost:5173,127.0.0.1:5173
SESSION_DOMAIN=null
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### 3. Frontend (web)

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

`frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
```

### 4. Mobile (Expo)

```bash
cd mobile
npm install
npm start                 # scan the QR code with Expo Go, or press a for Android
```

`mobile/.env` — pick the URL that matches your target:

| Target            | URL                          |
|-------------------|------------------------------|
| Android emulator  | `http://10.0.2.2:8000` (default) |
| iOS simulator     | `http://localhost:8000`      |
| Physical device   | `http://<your-LAN-IP>:8000`  |

## Demo accounts (after seeding)

| Email               | Password   | Role  |
|---------------------|------------|-------|
| admin@example.com   | password   | admin |
| member@example.com  | password   | member|

## Tests

```bash
cd backend
php artisan test          # 19 passing; uses sqlite in-memory, does not touch MySQL
```

## Architecture notes

- **API**: versioned under `/api/v1`, JSON via API Resources, validation via Form
  Requests, logic in `app/Services/*`, authorization via Policies.
- **SPA auth**: `GET /sanctum/csrf-cookie` → `POST /api/v1/login` → session cookie.
  Axios sends `withCredentials: true` and the `X-XSRF-TOKEN` header automatically.
- **Mobile auth**: `POST /api/v1/token-login` returns a bearer token stored in
  AsyncStorage and attached by an axios request interceptor.
- **Security**: CORS restricted to known origins, auth routes throttled 6/min,
  `.env` files gitignored, no secrets in source.
- **Production checklist**: set `APP_ENV=production`, `APP_DEBUG=false`, HTTPS
  `APP_URL`, update `SANCTUM_STATEFUL_DOMAINS` / `SESSION_DOMAIN` /
  `CORS_ALLOWED_ORIGINS` to the real frontend origin, and set
  `frontend/.env.production` to the deployed API URL.

## Troubleshooting

- **401/CORS errors in the browser**: confirm `SANCTUM_STATEFUL_DOMAINS` and
  `CORS_ALLOWED_ORIGINS` include the exact origin (with port) you're browsing from.
- **419 on login**: the CSRF cookie wasn't fetched — the frontend does this
  automatically; check that `/sanctum/csrf-cookie` is reachable.
- **Mobile can't connect**: `php artisan serve` binds to localhost; for physical
  devices use `php artisan serve --host=0.0.0.0` and the LAN IP.
