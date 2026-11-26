# CVO E2E — Puppeteer browser checks

Browser-level regression checks for the CVO web client. They use `puppeteer-core` against an installed Chrome or Chromium; there is no bundled browser.

## Requirements

- A running development stack (`docker compose up`, or a host-run backend and frontend).
- Chrome or Chromium. The scripts default to the Windows Chrome path; set `CHROME_PATH` anywhere else:

```bash
cd e2e
npm ci
CHROME_PATH="/usr/bin/chromium" node smoke.mjs
```

- `E2E_BASE` overrides the frontend URL (default `http://localhost:5173`).
- The full-stack suites sign in as the seeded `admin` account with the local password `password`, so run `php artisan db:seed` first.

## Scripts

| Script | Stack needed | Checks |
|---|---|---|
| `smoke.mjs` | frontend | Public pages render without console errors or layout overflow. |
| `e2e.mjs` | full stack | Sign-in, dashboard landing, and role-based access. |
| `dashboards.mjs` | frontend (API stubbed) | Dashboard shell, per-role navigation, RBAC redirects. |
| `admin-header.mjs` | frontend (API stubbed) | Header layout at desktop, tablet, and phone widths. |
| `connectivity.mjs` | frontend (API stubbed) | Offline bar and reconnect toast. |
| `toolbar-responsive.mjs` | frontend (API stubbed) | Monitoring toolbar from 320 px to 1920 px. |
| `map.mjs` | full stack | Map sizing, barangay polygons, labels, search, fullscreen. |
| `flightpath.mjs` | full stack | The trail grows and the pin moves after a re-dispersal. |
| `barangay-dispersal.mjs` | full stack | Report cards agree with the barangay table. |
| `verify-labels.mjs` | full stack | Map labels and per-barangay counts across pages. |
| `verify-panel.mjs` | full stack | Barangay click panel and per-animal actions. |
| `api-verify.mjs` | full stack | Dated snapshot API flow. |
| `barangay-smoke.mjs` | backend | API-level barangay reference checks. |
| `tunnel.mjs` | tunnel | Sign-in through a public tunnel URL (`node tunnel.mjs https://<host>`). |

Screenshots are written to `screenshots/`, which is gitignored.

## Docker

`docker compose --profile e2e run --rm e2e` installs Chromium in the container and runs `smoke.mjs`. The container's browser resolves `localhost` to the container itself, so the full-stack suites need `E2E_BASE` pointed at a host-reachable frontend and the SPA's `VITE_API_URL` pointed at a host-reachable API. The stubbed-API suites (`dashboards`, `admin-header`, `connectivity`, `toolbar-responsive`) do not need the backend.

These scripts are diagnostic checks, not a CI-gated suite.
