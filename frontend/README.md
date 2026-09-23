# CVO Frontend (React + Vite)

React 19 SPA (plain JavaScript) with Tailwind CSS 4, React Router 7, and cookie-based Sanctum auth against the Laravel API.

## Setup

```bash
npm install
```

### Environment

`.env` (local):

```env
VITE_API_URL=http://localhost:8005
```

`.env.production` is used by `npm run build` — point it at your deployed API.

> Vite only exposes variables prefixed with `VITE_`.

## Run

```bash
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
npm test         # Vitest + React Testing Library (unit tests)
npm run lint     # oxlint
```

## Dispersal map & lineage

- **Map**: MapLibre GL + OpenStreetMap raster tiles (no API key, no billing
  account, free open-source license). The map bundle is code-split and loads
  only on the map pages.
- **Accessibility**: maps are not screen-reader friendly, so every map is
  paired with a table view of the same beneficiaries (`DispersalMap`).
- **Geo-tagging**: `CoordinatePicker` in the registration form supports
  click-on-map, browser geolocation ("use my location") and manual entry.
- **Lineage**: the pass-on chain per beneficiary renders at
  `/dashboard/{role}/beneficiaries/{id}/lineage`.

Make sure the backend is running (`php artisan serve`) and that `backend/.env` contains:

```env
SANCTUM_STATEFUL_DOMAINS=localhost:5173,127.0.0.1:5173
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### Tunnelling (optional)

`npm run dev:ngrok` starts Vite in tunnel mode on port **5174**, reading
`frontend/.env.ngrok` (copy `.env.ngrok.example`). In that mode `vite.config.js`
additionally sets `allowedHosts`, proxies `/api` + `/sanctum` to the Laravel API
and pins HMR to `wss:443`, so the SPA talks to the API on the tunnel origin and
the Sanctum cookie stays first-party. Pair it with `tools/ngrok-dev.ps1`, which
writes the public host into `frontend/.env.ngrok` **and** `backend/.env` (see the
root README). Plain `npm run dev` on 5173 is unaffected.

## Auth flow (Sanctum SPA)

1. On app load, `AuthProvider` calls `GET /api/v1/user` to restore an existing session.
2. Before `login`/`register`, the app calls `GET /sanctum/csrf-cookie`; axios then
   automatically attaches the `X-XSRF-TOKEN` header from the cookie.
3. Subsequent requests carry the session cookie (`withCredentials: true`).
4. A global 401 interceptor clears auth state; `ProtectedRoute` redirects to `/login`.

## Structure

```
src/
├── api/          # axios instance + endpoint functions (unwrapped payloads)
├── components/   # Layout, routes guards, DispersalMap, CoordinatePicker, …
├── config/       # roles.js (nav/permissions), site.js (copy)
├── context/      # AuthProvider (user, login, register, logout)
├── hooks/        # useMediaQuery, useDebouncedValue
├── pages/        # AuthPage, dashboards, MonitoringPage, DispersalMapPage, …
├── routes/       # route definitions (map pages are lazy-loaded)
└── test/         # Vitest setup + unit tests
```

## Demo login (after `php artisan migrate --seed`)

- admin@example.com / password (all access)
- doctor@example.com / password
- technician@example.com / password
- farmer@example.com / password
