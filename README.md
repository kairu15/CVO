CVO — Livestock & Poultry Dispersal Tracking System

A full-stack information system built for a City Veterinary Office (CVO) to manage the geo-tagging, dispersal, and re-dispersal of livestock and poultry to beneficiary farmers, replacing manual, paper-based record keeping with a centralized digital workflow.

Overview
Local government veterinary offices run livestock and poultry dispersal programs that provide animals to farmer-beneficiaries across multiple barangays, with a compliance requirement to track offspring and re-dispersal over time. This system digitizes that process end-to-end: registering beneficiaries and animals, recording their location down to the barangay level, tracking the lifecycle of each dispersal, and giving CVO staff a role-appropriate view into program status across the city.

Key Features
- Beneficiary & animal registry — structured records for farmer-beneficiaries and the livestock/poultry dispersed to them
- Geo-tagging — location data down to the barangay level for every beneficiary and dispersal record
- Dispersal & re-dispersal tracking — full lifecycle tracking, including offspring and pass-on compliance
- Role-based dashboards — separate views and permissions for administrators, veterinary/technical staff, and farmer-beneficiaries
- Hierarchical navigation — drill-down from city → barangay → beneficiary
- In-system notifications — alerts for dispersal, vaccination, and re-dispersal milestones
- Mobile companion app — field-friendly access for staff conducting on-site visits

Tech Stack
| Layer      | Technology                         |
|-----------|------------------------------------|
| Backend API | Laravel, MySQL                     |
| Web frontend | React (Vite), Tailwind CSS, React Router |
| Mobile     | Expo (React Native), React Navigation |
| Authentication | Session-based (web) and token-based (mobile) |

Project Structure
```
CVO/
├── backend/     # API, database migrations, business logic
├── frontend/    # Web application (staff & admin dashboards)
├── mobile/      # Field companion app
└── e2e/         # End-to-end test suites
```

User Roles
The system supports distinct roles reflecting how a CVO actually operates:
- **Administrator** — full system access, staff account management, configuration
- **Veterinary/technical staff** — health records, field visits, dispersal and case management
- **Farmer-beneficiary** — self-registration and access to their own dispersal record

Access to every module is enforced consistently across the API and the interface, so a role's permissions can't be bypassed by navigating directly to a page.

Getting Started
> Setup requires a local PHP, Node.js, and MySQL environment. See each subproject's configuration files for the required environment variables — none are committed to this repository.

Install backend dependencies and run database migrations from `backend/`.
Install frontend dependencies and start the dev server from `frontend/`.
(Optional) Install mobile dependencies and run via Expo from `mobile/`.

Copy each subproject's example environment file and fill in local values — database credentials, API URLs, and allowed origins are environment-specific and must not be committed.

Refer to the setup notes inside `backend/`, `frontend/`, and `mobile/` for exact commands.

Testing
- Backend unit/feature tests run against an in-memory test database and do not touch production data.
- End-to-end tests in `e2e/` exercise the full stack, including authentication and role-based access.

Project Context
This system is being developed as a capstone project for a City Veterinary Office in Negros Oriental, Philippines, to support its livestock and poultry dispersal program across the city's barangays.

Status
Actively in development. Core registry, geo-tagging, and dispersal tracking modules are in progress; additional modules (reporting, extended notifications, system settings) are on the roadmap.

License
No license has been specified for this repository. All rights reserved by the project authors unless a license is added.

---

## Docker

The whole web stack (MySQL, the Laravel API and the React frontend) runs with one command, for both local development and production. `mobile/` is intentionally **not** containerized.

### Prerequisites

- Docker Desktop (or Docker Engine + Compose v2). ~4 GB of RAM free.
- No local PHP, Node or MySQL required.
- Ports used by default: **5173** (frontend), **8005** (API), **3307** (MySQL), **8081** (phpMyAdmin). Override them in `.env`.

### Quick start (development)

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env        # optional; compose sets VITE_API_URL too
docker compose up --build
```

Then open **http://localhost:5173**. The API is on **http://localhost:8005**.

On first boot the backend container waits for MySQL and runs `php artisan migrate --force`. Startup seeding is **off** (`RUN_SEEDERS=false`), so no demo beneficiaries, users or sample data are recreated on restart. To seed once, set `RUN_SEEDERS=true` in `.env` or run `docker compose exec backend php artisan db:seed --force`.

**Demo accounts** (password: `password`):

| Email                    | Role       |
|--------------------------|------------|
| admin@example.com        | admin      |
| doctor@example.com       | doctor     |
| technician@example.com   | technician |
| farmer@example.com       | farmer     |

### How it works

| Service   | Image / target            | Port(s)        | Notes                                                        |
|-----------|---------------------------|----------------|--------------------------------------------------------------|
| `db`      | `mysql:8.4`               | 3307 → 3306    | utf8mb4 / utf8mb4_unicode_ci, named volume, `mysqladmin` healthcheck |
| `backend` | `backend/Dockerfile` `dev`| 8005           | bind-mounted source, vendor in a named volume, `php artisan serve` |
| `frontend`| `frontend/Dockerfile` `dev`| 5173          | Vite dev server + HMR, source bind-mounted, node_modules in a named volume |
| `phpmyadmin` | `phpmyadmin:5.2`       | 8081           | only with `--profile tools`                                   |
| `e2e`     | `node:20-alpine`          | –              | only with `--profile e2e`                                     |

MySQL is published on **3307** by default so a host XAMPP/standalone MySQL on 3306 can keep running.

### Sanctum origins (why the URLs are what they are)

Sanctum's SPA cookie auth is origin-locked. In development the browser is on `http://localhost:5173` and the API on `http://localhost:8005`, so three settings are kept in sync (all in the root `.env`):

```env
VITE_API_URL=http://localhost:8005                                  # what the browser calls
SANCTUM_STATEFUL_DOMAINS=localhost:5173,127.0.0.1:5173               # hosts, no scheme
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173     # origins, with scheme
```

> `VITE_API_URL` must be a **host-reachable** URL. `http://backend:8005` is the container's own view of the service and is unreachable from the browser.

Because the two ports share the `localhost` host, the session/CSRF cookies stay first-party and `SESSION_DOMAIN` can stay empty (host-only cookie).

**Production uses a single origin instead** (recommended): the frontend's nginx serves the SPA and reverse-proxies `/api`, `/sanctum` and `/storage` to the backend, so the browser only ever sees one origin. Cookies are trivially first-party and CORS is not involved. That is why `docker-compose.prod.yml` builds the frontend with an empty `VITE_API_URL` (relative URLs).

### Common commands

`make help` lists everything. A few:

```bash
make up            # build + start the dev stack
make down          # stop it (data is kept)
make logs          # tail all logs
make migrate       # php artisan migrate --force
make seed          # php artisan db:seed --force
make fresh         # migrate:fresh --seed
make test          # php artisan test (in-memory sqlite, see below)
make shell-backend # shell into the API container
make shell-db      # mysql shell in the database container
make key           # print a fresh APP_KEY

# profiles
docker compose --profile tools up -d          # + phpMyAdmin on :8081
docker compose --profile e2e run --rm e2e     # e2e shell (see note below)
```

Raw compose equivalents work too, e.g. `docker compose exec backend php artisan test`.

### Tests

```bash
docker compose exec backend php artisan test
```

Tests run against an **in-memory SQLite** database and never touch the compose MySQL. `backend/phpunit.xml` forces `DB_CONNECTION`/`DB_DATABASE` (and friends) in both `$_ENV` and `$_SERVER`, because the dev container exports the MySQL ones and Laravel resolves `$_SERVER` first.

### Environment variables

| File                          | Purpose                                                        |
|-------------------------------|----------------------------------------------------------------|
| `.env`                        | compose variables for **development** (copy of `.env.example`)  |
| `.env.production`             | compose variables for **production** (copy of `.env.production.example`) |
| `backend/.env.docker.example` | Laravel env used when the dev container creates `backend/.env`  |
| `frontend/.env.example`       | `VITE_API_URL` and the optional dev port                       |

Real `.env*` files are gitignored; only the `*.example` files are committed. Never commit secrets.

### Production

```bash
cp .env.production.example .env.production

# 1. Fill in DB_PASSWORD / DB_ROOT_PASSWORD / APP_URL / SANCTUM_STATEFUL_DOMAINS.
# 2. Generate and paste a key:
php artisan key:generate --show                 # with local PHP, or:
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend php artisan key:generate --show

docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

The frontend is then served on **http://localhost:8080** (or `WEB_PORT`).

Production differences:

- The backend runs **nginx + php-fpm** under supervisord, not `php artisan serve`.
- `RUN_SEEDERS` defaults to **false** — the demo accounts are never created unless you ask. To seed once: `docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php artisan db:seed --force`.
- Config, routes and views are cached by the entrypoint (`APP_ENV=production`).
- The API and database are not published; only the frontend port is.
- Put TLS in front of the frontend port for a real deployment and set `SESSION_SECURE_COOKIE=true`.
- `VITE_API_URL` is a **build-time** argument for the production frontend (Vite inlines `import.meta.env.*`); leave it empty for the single-origin proxy, or set an absolute URL for a split-origin deploy and rebuild.

### Mobile

`mobile/` is not containerized. Point `EXPO_PUBLIC_API_URL` at the host machine:

- Android emulator: `http://10.0.2.2:8005`
- iOS simulator: `http://localhost:8005`
- Physical device: `http://<your-LAN-IP>:8005`

The API must listen on `0.0.0.0` (it does) and the host port must be reachable on the LAN. Physical devices cannot use `localhost`.

### Troubleshooting

- **Port already in use** — change `FRONTEND_PORT` / `API_PORT` / `DB_HOST_PORT` in `.env` and `docker compose up -d` again. If you change `FRONTEND_PORT`, also update `SANCTUM_STATEFUL_DOMAINS` and `CORS_ALLOWED_ORIGINS`.
- **`419` or CORS errors on login** — the Sanctum/CORS origins and the browser origin have drifted apart. They must match scheme + host + port.
- **Changed `composer.json` / `package.json`** — rebuild: `docker compose build backend` (or `frontend`). `make vendor` reinstalls composer deps in place.
- **Blank/stale frontend after dependency changes** — `docker compose down` then `docker compose up --build` (the `node_modules`/`vendor` named volumes are seeded once, on creation).
- **Reset the database** — `docker compose down -v` removes the named volumes, or `make fresh`.
- **HMR not picking up edits on Windows/macOS** — bind mounts do not always deliver filesystem events; the frontend runs with `CHOKIDAR_USEPOLLING=true`.
- **`app key` errors** — dev generates `APP_KEY` automatically into `backend/.env`; production requires you to set it explicitly.

### Notes / deviations found while containerizing

- The API's local port is **8005**, not 8000 (see `backend/.env.example` and `frontend/vite.config.js`).
- The base image is **PHP 8.4**, not 8.3: `composer.lock` pins Symfony 8.1.x, which requires PHP >= 8.4.1, so 8.3 cannot install the lock file. `composer.json`'s `^8.3` constraint is still satisfied.
- `backend/phpunit.xml` gained `force="true"` / `<server>` entries so `php artisan test` stays on in-memory SQLite inside the container (see Tests above).
- The `e2e` profile service installs the JS deps in a container, but the scripts currently hardcode a host Chrome path (`C:/Program Files/...`); point them at a container browser (`apk add chromium`) before expecting them to pass there.