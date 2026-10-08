#!/bin/sh
# =============================================================================
# CVO API container entrypoint
#
# Idempotent: safe to run on every container start. Order matters —
#   bootstrap .env → APP_KEY → wait for MySQL → storage link → migrate →
#   optional seed → optional prod caches → exec the main process.
#
# In the production image this starts as root (supervisord needs to spawn
# nginx), so artisan commands are run as the non-root `app` user to keep
# ownership of storage/ and bootstrap/cache/ correct. In the dev image the
# container already runs as `app`.
# =============================================================================
set -eu

log() { printf '[entrypoint] %s\n' "$*"; }

# Run a command as the application user when we are root, otherwise directly.
run_as_app() {
    if [ "$(id -u)" = "0" ] && command -v su-exec >/dev/null 2>&1; then
        su-exec app "$@"
    else
        "$@"
    fi
}

cd /var/www/html

# -----------------------------------------------------------------------------
# 1. Bootstrap an .env for local dev
#
# Production receives every value as a real environment variable, so no .env is
# written there (it would be ignored anyway — real env always beats Dotenv).
# -----------------------------------------------------------------------------
if [ "${APP_ENV:-production}" != "production" ] && [ ! -f .env ] && [ -f .env.docker.example ]; then
    log "No .env found — creating one from .env.docker.example"
    cp .env.docker.example .env
fi

# -----------------------------------------------------------------------------
# 2. APP_KEY
#
# Never hardcoded. Dev generates and persists one so sessions survive restarts;
# production refuses to boot with an empty key (set it from your secret store).
# -----------------------------------------------------------------------------
if [ -z "${APP_KEY:-}" ]; then
    if [ "${APP_ENV:-production}" = "production" ]; then
        log "ERROR: APP_KEY is empty in production."
        log "Generate one with:  php artisan key:generate --show"
        log "then set APP_KEY in your production environment and restart."
        exit 1
    fi
    log "APP_KEY empty — generating one into .env (development only)"
    run_as_app php artisan key:generate --force >/dev/null 2>&1 || true
fi

# -----------------------------------------------------------------------------
# 3. Wait for MySQL
#
# TCP probe rather than `php artisan db:monitor` so it works before the
# application bootstraps (and without a configured key). Credentials are not
# needed just to know the server is accepting connections.
# -----------------------------------------------------------------------------
if [ "${DB_CONNECTION:-mysql}" = "mysql" ] || [ "${DB_CONNECTION:-}" = "mariadb" ]; then
    db_host="${DB_HOST:-db}"
    db_port="${DB_PORT:-3306}"
    log "Waiting for database ${db_host}:${db_port} ..."
    until php -r 'exit(@fsockopen(getenv("DB_HOST") ?: "db", (int)(getenv("DB_PORT") ?: 3306)) ? 0 : 1);' 2>/dev/null; do
        sleep 2
    done
    log "Database is reachable"
fi

# -----------------------------------------------------------------------------
# 4. Public storage symlink (avatars, field-visit photos)
# -----------------------------------------------------------------------------
run_as_app php artisan storage:link >/dev/null 2>&1 || true

# -----------------------------------------------------------------------------
# 5. Migrations
# -----------------------------------------------------------------------------
log "Running migrations"
run_as_app php artisan migrate --force

# -----------------------------------------------------------------------------
# 6. Seeders — opt-in only
#
# Seeding creates demo accounts with a known password, so it must never run by
# default outside development. RUN_SEEDERS=true opts in (safe to repeat: the
# seeders use updateOrCreate).
# -----------------------------------------------------------------------------
if [ "${RUN_SEEDERS:-false}" = "true" ]; then
    log "RUN_SEEDERS=true — seeding database"
    run_as_app php artisan db:seed --force
fi

# -----------------------------------------------------------------------------
# 7. Caches — production builds them, development refuses them
#
# Production caches config/routes/views for speed (the image is immutable).
# Development starts from a clean slate every boot: cached artifacts built
# against older code or env are a classic "why is my change not taking effect"
# trap, and OPcache is already off in the dev image (docker/php-dev.ini).
# -----------------------------------------------------------------------------
if [ "${APP_ENV:-production}" = "production" ]; then
    log "APP_ENV=production — caching config, routes and views"
    run_as_app php artisan config:cache
    run_as_app php artisan route:cache
    run_as_app php artisan view:cache
else
    log "Development mode — clearing config, route, view and app caches"
    run_as_app php artisan config:clear >/dev/null 2>&1 || true
    run_as_app php artisan route:clear >/dev/null 2>&1 || true
    run_as_app php artisan view:clear >/dev/null 2>&1 || true
    run_as_app php artisan cache:clear >/dev/null 2>&1 || true
fi

# -----------------------------------------------------------------------------
# 8. Hand off to the container's main process
# -----------------------------------------------------------------------------
log "Starting: $*"
exec "$@"
