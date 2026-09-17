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
php artisan serve          # http://localhost:8005
```

Key `backend/.env` values:

```env
APP_URL=http://localhost:8005
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
VITE_API_URL=http://localhost:8005
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
| Android emulator  | `http://10.0.2.2:8005` (default) |
| iOS simulator     | `http://localhost:8005`      |
| Physical device   | `http://<your-LAN-IP>:8005`  |

## Demo accounts (after seeding)

Login accepts either the email or the username.

| Email                  | Username     | Password   | Role       | Dashboard              |
|------------------------|--------------|------------|------------|------------------------|
| admin@example.com      | `admin`      | password   | admin      | /dashboard/admin       |
| doctor@example.com     | `doctor`     | password   | doctor     | /dashboard/doctor      |
| technician@example.com | `technician` | password   | technician | /dashboard/technician  |
| farmer@example.com     | `farmer`     | password   | farmer     | /dashboard/farmer      |

Public self-registration always creates a **farmer**. Staff roles are assigned
by an administrator — the register form's role field is locked and the API
ignores any `role` value sent with the payload.

### All access account

`admin@example.com` (or username `admin`) is the **all access** login: it can
open all four dashboards, not just its own. The sidebar shows a switcher listing
every workspace, and a banner marks when you are viewing one that is not your
own. A scoped role only ever sees its own dashboard and is redirected if it
tries to open another.

The rule lives in `ALL_ACCESS_ROLES` in `frontend/src/config/roles.js`, so
adding a second all access role (or a dedicated superuser) is a one-line change.
**This guards routing in the SPA only** — when the dashboard modules get real
endpoints, the same rule has to be enforced per endpoint on the API side.

## Tests

```bash
cd backend
php artisan test          # 22 passing; uses sqlite in-memory, does not touch MySQL
```

End-to-end browser checks live in `e2e/` (puppeteer-core driving the installed
Chrome). They need the backend, frontend and MySQL all running:

```bash
cd e2e
node e2e.mjs               # full stack: landing, sliding auth panel, all four dashboards, RBAC
node dashboards.mjs        # dashboard shells only — stubs the API, no backend or database needed
node smoke.mjs             # landing + auth panel only
node geometry.mjs          # sliding-panel geometry and responsive overflow checks
```

## Frontend structure

| Path                          | Purpose                                                        |
|-------------------------------|----------------------------------------------------------------|
| `/`                           | Public landing page (navbar, hero, about, services, roles, footer) |
| `/login`, `/register`         | Sliding auth panel — one component, `mode` comes from the route  |
| `/dashboard`                  | Forwards to the signed-in user's own role dashboard             |
| `/dashboard/{role}`           | Blank dashboard scaffold; guarded by `RoleRoute`                |

- **Design tokens** live in `frontend/src/index.css` under `@theme` — the light
  green `brand-*` ramp, the `earth-*` accent, fonts, radius and elevation.
  `brand-700` is the lightest green that keeps white button text at WCAG AA;
  `brand-400`/`brand-500` are for surfaces and accents. Reusable recipes
  (`card`, `field`, `btn-primary`, `btn-secondary`, `btn-on-brand`, `eyebrow`)
  are `@utility` definitions in the same file.
- **Roles** live in `frontend/src/config/roles.js` — dashboard path, label,
  sidebar items and icons per role, plus the `ALL_ACCESS_ROLES` list. One
  `DashboardLayout` and one `RoleDashboard` serve all four roles, so the
  dashboards cannot drift apart.
- **Sidebar placeholders** have no `to` value; the sidebar renders them as
  inert rows tagged "Soon". Add a `to` once the module's route exists.
- **Copy and contact details** live in `frontend/src/config/site.js`. The email,
  phone and social links there are placeholders — replace them before launch.

## Architecture notes

- **API**: versioned under `/api/v1`, JSON via API Resources, validation via Form
  Requests, logic in `app/Services/*`, authorization via Policies.
- **Roles**: `admin`, `doctor`, `technician`, `farmer` (`App\Models\User::ROLES`).
  Role checks are a routing guard in the SPA — any endpoint feeding these
  dashboards must enforce the same rule server-side.
- **Migration note**: the starter template's `member` role was backfilled to
  `farmer`, so pre-existing accounts keep working.
- **SPA auth**: `GET /sanctum/csrf-cookie` → `POST /api/v1/login` → session cookie.
  Axios sends `withCredentials: true` and the `X-XSRF-TOKEN` header automatically.
- **Mobile auth**: `POST /api/v1/token-login` returns a bearer token stored in
  AsyncStorage and attached by an axios request interceptor.
- **Security**: CORS restricted to known origins, auth routes throttled 6/min,
  `.env` files gitignored, no secrets in source.
- **Vendor hygiene**: `vendor/`, `node_modules/`, and `.env` files are
  gitignored at the repo root — dependencies are always installed from
  `backend/composer.lock` and `frontend/package-lock.json`, never committed.
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
