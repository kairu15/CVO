# CVO — Production Deployment Guide

Production-ready deployment reference for the **Livestock & Poultry Dispersal Tracking System** (City Veterinary Office).

This document covers only **production**. For local development, see [`README.md`](README.md).

---

## 1. Architecture

Production runs a **single-origin** topology: one public URL, one host, no CORS.

```
                       ┌──────────────────────────────────────────────┐
 browser ──HTTP(S)──▶  │ frontend (nginx)                             │
                       │   • serves the React SPA (dist/)            │
                       │   • reverse-proxies:                        │
                       │       /api, /sanctum, /storage,            │
                       │       /secure-files, /up                    │
                       └───────────────────┬──────────────────────────┘
                                           │ internal network only
                       ┌───────────────────▼──────────────────────────┐
                       │ backend (nginx + php-fpm, supervisord)      │
                       │   • Laravel API, migrations on boot         │
                       └───────────────────┬──────────────────────────┘
                                           │ internal network only
                       ┌───────────────────▼──────────────────────────┐
                       │ db (mysql:8.4)                              │
                       │   • named volume db_data, no published port │
                       └──────────────────────────────────────────────┘
```

Key consequences of this design:

- The browser only ever sees **one origin**, so Sanctum's session cookies are first-party and **CORS never applies**.
- Only the **frontend port** is published (`WEB_PORT`, default `8080`). The API and MySQL are reachable only on the internal Compose network.
- `VITE_API_URL` must be **empty** for the single-origin proxy. Set an absolute URL only for a split-origin deploy (and rebuild — it is a build-time value).

### Images (multi-stage)

| Service  | Dockerfile             | Target       | Runtime                                |
|----------|------------------------|--------------|----------------------------------------|
| `db`     | `mysql:8.4`            | —            | utf8mb4 / `utf8mb4_unicode_ci`, volume `db_data`, `mysqladmin` healthcheck |
| `backend`| `backend/Dockerfile`   | `production` | nginx + php-fpm under supervisord, PHP 8.4, non-root `app` user |
| `frontend`| `frontend/Dockerfile`  | `production` | `nginx:1.27-alpine` serving `dist/` + the reverse proxy |

Build context for **both** images is the **repository root** (not the subproject directory):

```bash
docker build -f backend/Dockerfile  .
docker build -f frontend/Dockerfile .
```

`mobile/` is intentionally **not** containerized.

### What the backend entrypoint does on every start

`backend/docker/entrypoint.sh` is idempotent and runs in this order:

1. Refuses to boot if `APP_KEY` is empty (production).
2. Waits for MySQL over a TCP probe (`DB_HOST:DB_PORT`).
3. `php artisan storage:link`
4. `php artisan migrate --force` — migrations always run automatically.
5. `php artisan db:seed --force` **only** when `RUN_SEEDERS=true` (off by default).
6. With `APP_ENV=production`: caches config, routes and views.
7. Rebinds nginx to `$PORT` when a platform injects one (Render sets `10000`); otherwise it stays on `8080`.
8. Starts supervisord (nginx + php-fpm).

---

## 2. Prerequisites

- Docker Engine/Desktop with Compose **v2** (`docker compose version` ≥ 2.x).
- ~4 GB free RAM for build and run.
- **No** local PHP, Node.js or MySQL needed.
- Outbound HTTPS for pulling base images and (on first build) package registries.
- For a real deployment: a TLS terminator in front of the frontend port (Caddy, nginx, a cloud load balancer, or your PaaS's edge).

Default ports (overridable in `.env.production`):

| Variable      | Default | Purpose                              |
|---------------|---------|--------------------------------------|
| `WEB_PORT`    | `8080`  | The single public entry point        |
| `API_PORT`    | `8005`  | dev only (not published in prod)     |
| `DB_HOST_PORT`| `3307`  | dev only (not published in prod)     |

---

## 3. Configuration (`.env.production`)

```bash
cp .env.production.example .env.production
```

`.env.production` is **gitignored** — only the `*.example` files are committed. Never commit secrets.

### Required variables

The compose file refuses to start (`${VAR:?...}`) without these:

| Variable | Example | Notes |
|----------|---------|-------|
| `DB_DATABASE` | `cvo` | MySQL database name (created by the `db` service) |
| `DB_USERNAME` | `cvo_user` | MySQL application user |
| `DB_PASSWORD` | *(strong, random)* | Application password |
| `DB_ROOT_PASSWORD` | *(strong, random)* | MySQL root password (healthcheck + admin) |
| `APP_KEY` | `base64:...` | See [§4](#4-generate-app_key) — the entrypoint exits if empty |
| `APP_URL` | `https://cvo.example.gov.ph` | The **public** origin users visit (single-origin ⇒ the frontend origin) |
| `SANCTUM_STATEFUL_DOMAINS` | `cvo.example.gov.ph` | Host + port, **no scheme** — the public host of the app |

### Optional variables

| Variable | Default | When to change it |
|----------|---------|-------------------|
| `WEB_PORT` | `8080` | Host port for the public entry point |
| `SESSION_DOMAIN` | *(empty, host-only cookie)* | Set to the public domain only if TLS is terminated behind a proxy that rewrites `Host` |
| `SESSION_SECURE_COOKIE` | `false` | Set `true` once you serve over **HTTPS** |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Only if something genuinely calls the API cross-origin |
| `RUN_SEEDERS` | `false` | `true` for a one-off seeding run, then set back |
| `VITE_API_URL` | *(empty)* | **Build-time.** Leave empty for single-origin; absolute API URL only for a split-origin deploy |

### `.env.production` template

```dotenv
# --- Compose / database (required) ---
DB_DATABASE=cvo
DB_USERNAME=cvo_user
DB_PASSWORD=change-me
DB_ROOT_PASSWORD=change-me-too

# --- Laravel (required) ---
APP_KEY=base64:PASTE_GENERATED_KEY
APP_URL=https://cvo.example.gov.ph

# Host:port of the public origin, no scheme (required)
SANCTUM_STATEFUL_DOMAINS=cvo.example.gov.ph

# --- Cookies / CORS ---
SESSION_DOMAIN=
SESSION_SECURE_COOKIE=true
CORS_ALLOWED_ORIGINS=https://cvo.example.gov.ph

# --- Seeding (keep false in production) ---
RUN_SEEDERS=false

# --- Public port / build args ---
WEB_PORT=8080
VITE_API_URL=
```

---

## 4. Generate `APP_KEY`

Production **never** generates a key automatically. Any one of these works:

```bash
# With local PHP
php artisan key:generate --show

# Makefile (dev stack must be running)
make key

# From the production image itself (no local PHP required)
docker compose --env-file .env.production -f docker-compose.prod.yml \
  run --rm --no-deps backend php artisan key:generate --show
```

Paste the whole `base64:...` value into `APP_KEY` in `.env.production`. Rotating it invalidates all existing sessions and encrypted attributes — treat it as a secret and store it in your secret manager.

---

## 5. Deploy — Docker Compose (self-hosted / VM)

### First deploy

```bash
cp .env.production.example .env.production
$EDITOR .env.production          # DB_*, APP_KEY, APP_URL, SANCTUM_STATEFUL_DOMAINS

make prod-up                     # = docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Or, without `make`:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

The app is then available at **http://\<host\>:8080** (or `WEB_PORT`).

### Day-2 commands

```bash
make prod-up      # build + start
make prod-ps      # container status + health
make prod-logs    # tail logs (all services)
make prod-down    # stop (data volume is kept)
```

Migrations run automatically on every boot. To run them by hand:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend \
  php artisan migrate --force
```

Raw equivalents work too, e.g.:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php artisan tinker
```

### One-off seeding

Demo accounts are **never** created unless you ask:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec backend php artisan db:seed --force
```

Then keep `RUN_SEEDERS=false`. The seeders use `updateOrCreate`, so repeating a seed is safe.

### Putting TLS in front

Terminate TLS at the edge (Caddy, nginx, a cloud LB) and proxy to `WEB_PORT`:

```nginx
server {
    listen 443 ssl http2;
    server_name cvo.example.gov.ph;
    # ssl_certificate ...; ssl_certificate_key ...;

    client_max_body_size 12m;   # matches the frontend nginx / PHP upload ceiling

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

With HTTPS live, set in `.env.production` and restart:

```dotenv
SESSION_SECURE_COOKIE=true
```

and make `APP_URL` / `SANCTUM_STATEFUL_DOMAINS` match the public origin exactly (`https://host` / `host`).

---

## 6. Deploy — Render (blueprint)

[`render.yaml`](render.yaml) defines two Docker web services from this repo:

| Service | Dockerfile | Health check | Purpose |
|---------|-----------|--------------|---------|
| `cvo-backend`  | `backend/Dockerfile`  | `/up`  | Laravel API |
| `cvo-frontend` | `frontend/Dockerfile` | `/`    | SPA + reverse proxy (the URL users open) |

Both build with the **repo root** as context (`dockerfilePath: backend/Dockerfile` / `frontend/Dockerfile`) — the same command as the local compose build.

### Database

Render has **no managed MySQL**, and the backend image ships `pdo_mysql` but not `pdo_pgsql`, so point the backend at an **external MySQL** (Aiven, Clever Cloud, Railway, TiDB Cloud, …) via `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` in the Render dashboard. Alternatively run MySQL as its own service with a persistent disk (paid).

### Required dashboard values (`sync: false`)

Set these in the Render dashboard — the blueprint deliberately leaves them unset:

| Service | Key | Value |
|---------|-----|-------|
| `cvo-backend` | `APP_KEY` | output of `php artisan key:generate --show` |
| `cvo-backend` | `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | your external MySQL |
| `cvo-frontend` | `BACKEND_UPSTREAM` | the backend's public origin, e.g. `https://cvotestfinal.onrender.com` |

Everything else is already set in the blueprint: `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL` = frontend origin, `SANCTUM_STATEFUL_DOMAINS` = frontend host, `SESSION_SECURE_COOKIE=true`, `SESSION_SAME_SITE=lax`, `CACHE_STORE=file`, `RUN_SEEDERS=false`, `VITE_API_URL=""`, `FRONTEND_URL` = frontend origin.

### Deploy

1. Push to the repo (both services use `autoDeployTrigger: commit`), or click **Manual Deploy**.
2. Open the **frontend** URL — that is the app. The backend's own URL answers Laravel's welcome page on `/`; it is the API, not the UI.
3. First run: set `RUN_SEEDERS=true` on `cvo-backend`, redeploy (or trigger a restart) to create demo logins, then set it back to `false`.

### Render notes

- The frontend nginx proxy reaches the backend over its **public** URL because free Render services cannot use private networking, so `proxy_ssl_server_name on` is already configured and `Host $proxy_host` avoids an edge routing loop.
- `VITE_API_URL` is a **build-time** value on Render (passed as a Docker build arg). Changing it requires a rebuild, not a restart.
- `CACHE_STORE=file` keeps cache hits off the network (the MySQL instance is external to Render); the cache is rebuilt after each deploy on this single-instance service.
- The entrypoint rebinds nginx to `$PORT` (Render defaults to `10000`), so port detection never fails the deploy.

---

## 7. Mobile app in production

`mobile/` is not containerized. Set `EXPO_PUBLIC_API_URL` to an address the device can reach:

- Public single-origin deploy: the **backend's public origin** (the API), e.g. `https://cvo-api.example.gov.ph`.
- LAN testing: `http://<host-LAN-IP>:8005` with the dev stack running (`0.0.0.0` binding is already in place). Physical devices cannot use `localhost`.
- Android emulator: `http://10.0.2.2:8005` · iOS simulator: `http://localhost:8005`.

The API must be reachable from the device; in production that means publishing the backend port or fronting it with TLS — the compose prod file publishes **only** the frontend port by design.

---

## 8. Verification checklist

Run after every deploy:

```bash
# 1. Containers healthy
docker compose --env-file .env.production -f docker-compose.prod.yml ps

# 2. Health endpoint through the public origin (proxied /up)
curl -fsS http://localhost:8080/up

# 3. API reachable through the proxy (session-free endpoint)
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/v1/site
# 200 — any other status means the /api proxy or the backend is down

# 4. SPA served
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:8080/
# 200 with text/html; /assets/* are immutable-cached, /index.html is no-store

# 5. Only the frontend is published (backend/db must show no host ports)
docker ps --filter 'name=cvo-prod' --format '{{.Names}}\t{{.Ports}}'
# expect 0.0.0.0:8080->80/tcp on the frontend container, nothing on the others
```

In the browser:

- Login page loads over **HTTPS**, no mixed-content warnings.
- Login succeeds; the session cookie is `Secure`, `HttpOnly`, `SameSite=Lax` and scoped to the public host.
- Images/avatars render (they come from `/storage/` and `/secure-files/`, both proxied).
- A role-restricted page is blocked for the wrong role (permissions are enforced in the API, not just the UI).

On Render: both services show **Healthy** (`/up` and `/`), and the frontend URL loads the app.

---

## 9. Backups & data

All MySQL data lives in the Compose volume **`db_data`**.

```bash
# Logical dump (run on the host; requires mysql client or a container)
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
  sh -lc 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
  > "backup-$(date +%F-%H%M).sql"

# Restore
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
  sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < backup.sql
```

- Take dumps **before** every deploy that includes migrations.
- `docker compose down` keeps `db_data`; `down -v` **destroys it** — never run `-v` in production.
- For an external/Render database, use that provider's snapshot feature as well.

---

## 10. Upgrades & rollback

```bash
# Upgrade
git pull
make prod-up        # rebuilds images, restarts; migrations run on boot

# Roll back to a previous image/tag
git checkout <previous-sha>
make prod-up
# then apply any *backward-compatible* migration state if the rollback
# expects an older schema — restore the matching DB dump when in doubt.
```

Deploy ordering that keeps downtime low: build first, then restart.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Because migrations run in the entrypoint with `--force`, a bad migration fails fast in the logs (`docker compose ... logs backend`) rather than at first request.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Container exits with `APP_KEY is empty in production` | `APP_KEY` not set | Generate it (§4) and restart |
| Compose refuses to start: `set DB_DATABASE in .env.production` | Missing required var | Fill in `.env.production` (§3) |
| `419` / CSRF on login | Origin or session misconfigured | `APP_URL`, `SANCTUM_STATEFUL_DOMAINS` and the URL in the browser must match (host:port, no scheme for Sanctum) |
| Cookie not sent after enabling HTTPS | `SESSION_SECURE_COOKIE` still `false` | Set it `true`, restart |
| Blank page / old bundle after a deploy | Stale `index.html` or assets | Rebuild: `docker compose ... up -d --build`; `index.html` is `no-store`, assets are hashed |
| API calls fail, images broken on Render | `BACKEND_UPSTREAM` unset or wrong | Set it to the backend's public origin on the frontend service |
| nginx dies with `host not found in upstream "backend"` | Compose service name used outside the compose network | Use `BACKEND_UPSTREAM` (the template is an envsubst variable; the image defaults to `http://localhost:8080`) |
| Frontend builds but the API URL is wrong | `VITE_API_URL` changed without a rebuild | It is a **build-time** arg — rebuild the frontend image |
| Port already in use | Host port conflict | Change `WEB_PORT` in `.env.production` and restart |
| Migrations not applied | Entrypoint failed before step 4 | `docker compose ... logs backend` — the entrypoint exits non-zero (`set -eu`) |
| Backend healthcheck failing | PHP-FPM/nginx not up | `docker compose ... logs backend`, check supervisord output |
| Demo accounts exist in production | `RUN_SEEDERS=true` left on | Set it back to `false`; disable/delete the demo users |

---

## 12. Security checklist

- [ ] `.env.production` is **not** committed (gitignored; only `*.example` in git).
- [ ] `APP_KEY`, `DB_PASSWORD`, `DB_ROOT_PASSWORD` are strong and stored in a secret manager.
- [ ] `APP_DEBUG=false` and `APP_ENV=production` (set by the compose file / blueprint).
- [ ] `RUN_SEEDERS=false` outside the one-off seeding run; demo accounts removed.
- [ ] TLS enabled end-to-end; `SESSION_SECURE_COOKIE=true`.
- [ ] Only the frontend port published; DB and API stay on the internal network.
- [ ] MySQL root password never used by the application (the app uses `DB_USERNAME`).
- [ ] Database backups scheduled and restore-tested.
- [ ] Base images and dependencies refreshed periodically (`docker compose ... build --no-cache`).

---

## Quick reference

```bash
# First deploy
cp .env.production.example .env.production   # then edit
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps \
  backend php artisan key:generate --show    # paste into APP_KEY
make prod-up

# Everyday
make prod-ps      make prod-logs      make prod-down

# Health + API smoke check
curl -fsS http://localhost:8080/up
curl -fsS http://localhost:8080/api/v1/site
```

See [`README.md`](README.md) for development setup, `make help` for every target, and [`render.yaml`](render.yaml) for the PaaS blueprint.
