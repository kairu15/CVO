# CVO — City Veterinary Office Livestock Traceability

**CVO** is a full-stack monorepo for the City Veterinary Office’s livestock and poultry traceability system. It tracks animal dispersal to farmer‑beneficiaries, monitors health and body‑condition data through re‑dispersal chains, and provides role‑based dashboards for admins, veterinarians, technicians, and farmers.

Built as a monorepo with:

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

### 5. Tunnelling the dev server (ngrok, optional)

To let a phone, a teammate or a webhook reach your machine, put the dev server
behind an ngrok tunnel. Sanctum cookie auth is origin-locked, so the SPA has to
reach the API on the **tunnel** origin: tunnel Vite and let it proxy the API, and
the session cookie stays first-party. Tunnelling the API on its own and leaving
the SPA on `localhost` breaks login (cross-site cookie + `same_site=lax`).

```bash
cd frontend
npm run dev:ngrok                                   # vite --mode ngrok, port 5174
powershell -ExecutionPolicy Bypass -File tools/ngrok-dev.ps1
```

`tools/ngrok-dev.ps1` starts (or reuses) the agent, reads the public URL from
ngrok's local API, and writes it into the only two places it has to appear:

| File | What changes |
|------|--------------|
| `frontend/.env.ngrok` | `VITE_API_URL=` (relative), `VITE_TUNNEL_HOST=<host>`, `VITE_DEV_PORT=5174` |
| `backend/.env` | `<host>` appended to (and later replaced in) `SANCTUM_STATEFUL_DOMAINS` |

Vite restarts itself when `.env.ngrok` changes and `php artisan serve` re-reads
`.env` on every request, so neither server needs a manual restart. A free account
is assigned one domain and the agent reclaims it on restart, but the script
rewrites both files every run anyway — so the habit is: start the agent, then open
the URL it prints. `-Stop` shuts the agent down again.

Worth knowing:

- The first browser visit shows ngrok's free-tier interstitial; click *Visit
  Site* once. Requests carrying `ngrok-skip-browser-warning: true` (curl, the
  `e2e/` scripts) skip it.
- `vite.config.js` only adds `allowedHosts`, the `/api` + `/sanctum` proxy and
  `hmr: { protocol: 'wss', clientPort: 443 }` when `VITE_TUNNEL_HOST` is set, so
  `npm run dev` and the `e2e/` suites behave exactly as before.
- **Mobile** can point at the same URL — `EXPO_PUBLIC_API_URL=https://<host>`:
  `/api/v1/*` is proxied to Laravel and bearer tokens need no cookie or CORS
  setup. Verified against `/api/v1/token-login`.
- Don't leave the tunnel open: `APP_DEBUG=true` means a public error page can
  leak stack traces and env values, and the seeded demo logins are live.

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
php artisan test          # 68 passing; uses sqlite in-memory, does not touch MySQL
```

End-to-end browser checks live in `e2e/` (puppeteer-core driving the installed
Chrome). They need the backend, frontend and MySQL all running:

```bash
cd e2e
node e2e.mjs               # full stack: landing, sliding auth panel, all four dashboards, RBAC
node dashboards.mjs        # dashboard shells only — stubs the API, no backend or database needed
node smoke.mjs             # landing + auth panel only
node geometry.mjs          # sliding-panel geometry and responsive overflow checks
node monitoring-overflow.mjs [role]  # monitoring table: window must not scroll horizontally
node sidebar-active.mjs [role ...] [cross]  # sidebar highlights only the current page
node tunnel.mjs https://<host>   # sign-in through an ngrok tunnel (see step 5 above)
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
- **Dispersal map**: MapLibre GL + OpenStreetMap (no API key), split into a lazy
  chunk loaded only by the map pages. The map is always paired with a table
  view of the same beneficiaries for screen-reader users. Geo-tagging happens
  at registration (map picker / browser geolocation) or in the field from the
  Expo app (`expo-location`); coordinates live on `beneficiaries` and demo
  chains are seeded.
- **Dispersal lineage**: `GET /api/v1/beneficiaries/{id}/lineage` returns the
  pass-on chain (original household → … → current) plus where the animal's
  offspring went. The UI renders it at `/dashboard/{role}/beneficiaries/{id}/lineage`.
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
- **419/401 only through a tunnel**: the tunnel host is missing from
  `SANCTUM_STATEFUL_DOMAINS`, or the tunnel points at `npm run dev` (which is
  built with an absolute `VITE_API_URL`) instead of `npm run dev:ngrok`. Run
  `tools/ngrok-dev.ps1` after (re)starting the agent.
