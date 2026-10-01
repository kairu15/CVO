# syntax=docker/dockerfile:1.7

# =============================================================================
# CVO API — multi-stage image
#
#   base        php:8.4-fpm-alpine + the extensions Laravel actually needs
#   vendor      composer install --no-dev from composer.lock (on top of base)
#   dev         base + dev dependencies; runs `php artisan serve` for local work
#   production  base + vendor + source; nginx + php-fpm under supervisord
#
# Build a specific target with `--target dev` / `--target production`
# (docker-compose.yml selects them). PHP-FPM is the runtime here rather than
# Apache/FrankenPHP because it is the smallest, most standard pairing for the
# nginx + php-fpm setup this project documents, and it keeps the production
# and dev images on one base.
#
# NOTE ON PHP VERSION: composer.json declares ^8.3, but composer.lock pins
# Symfony 8.1.x, which requires PHP >= 8.4.1 — so 8.3 cannot install the lock
# file. PHP 8.4 satisfies the ^8.3 constraint and the lock, so it is the floor.
# =============================================================================

ARG PHP_VERSION=8.4

# -----------------------------------------------------------------------------
# Stage 1 — shared runtime (extensions, composer, non-root user)
# -----------------------------------------------------------------------------
FROM php:${PHP_VERSION}-fpm-alpine AS base

# Runtime libraries the compiled extensions link against are listed FIRST and
# installed explicitly. Without that, `apk del` would treat them as dependencies
# orphaned by removing the *-dev packages and delete them too, leaving gd/intl/
# zip unable to load (missing libpng16.so.16, libicuio.so.78, libzip.so.5).
# The *-dev packages are compile-only and are removed in the same layer.
RUN apk add --no-cache \
        libpng \
        libjpeg-turbo \
        freetype \
        icu-libs \
        libzip \
        oniguruma \
        oniguruma-dev \
        libzip-dev \
        icu-dev \
        libpng-dev \
        libjpeg-turbo-dev \
        freetype-dev \
        sqlite-dev \
        su-exec \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" \
        pdo_mysql \
        pdo_sqlite \
        mbstring \
        bcmath \
        zip \
        intl \
        gd \
        exif \
        opcache \
        pcntl \
    && apk del --no-network \
        oniguruma-dev \
        libzip-dev \
        icu-dev \
        libpng-dev \
        libjpeg-turbo-dev \
        freetype-dev \
        sqlite-dev

# Composer is needed at build time for the dev target and at runtime for the
# Makefile's composer shortcuts.
COPY --from=composer:2.8 /usr/bin/composer /usr/bin/composer

# Non-root account that owns the application code and runs php-fpm workers.
RUN addgroup -S app && adduser -S -G app -u 1000 app

# CVO's php/opcache overrides. The `zz-` prefix makes it load after the image
# defaults, so these values win.
COPY docker/php.ini /usr/local/etc/php/conf.d/zz-cvo.ini

WORKDIR /var/www/html

COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Waits for MySQL, migrates, seeds on request, then execs the stage's CMD.
# Declared on the shared base so both dev and production inherit it.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# -----------------------------------------------------------------------------
# Stage 2 — production vendor directory
#
# Built on `base` rather than the generic composer image so the exact extension
# set the app needs is present: phpoffice/phpspreadsheet (via maatwebsite/excel)
# requires ext-gd, which composer:2.8 does not ship. Basing it here also means
# the dependency resolution happens under the same PHP version as runtime.
# -----------------------------------------------------------------------------
FROM base AS vendor

WORKDIR /var/www/html

# Manifests first so this layer only rebuilds when dependencies change.
COPY composer.json composer.lock ./

# --no-scripts: artisan is not present yet; the autoload scripts run below once
# the full source tree (and therefore artisan) has been copied in.
RUN composer install \
        --no-dev \
        --no-scripts \
        --no-autoloader \
        --no-interaction \
        --prefer-dist \
        --optimize-autoloader

COPY . .

# A classmap-authoritative autoloader is safe here because the image is
# immutable — no files are added at runtime.
RUN composer dump-autoload \
        --no-dev \
        --optimize \
        --classmap-authoritative \
        --no-interaction

# -----------------------------------------------------------------------------
# Stage 3 — development
#
# The compose dev service bind-mounts ./backend over /var/www/html and keeps
# vendor/ in a named volume, so this stage only has to guarantee that a fresh
# volume has a complete vendor tree (including dev/test dependencies) to seed
# from on first `up`.
# -----------------------------------------------------------------------------
FROM base AS dev

ENV APP_ENV=local

COPY composer.json composer.lock ./
RUN composer install \
        --no-interaction \
        --prefer-dist \
        --optimize-autoloader \
        --no-scripts \
        --no-autoloader

COPY . .

# Re-run autoload + Laravel's package:discover script now that artisan exists.
RUN composer dump-autoload --optimize --no-interaction

RUN mkdir -p \
        storage/framework/cache/data \
        storage/framework/sessions \
        storage/framework/views \
        storage/logs \
        bootstrap/cache \
    && chown -R app:app storage bootstrap/cache

USER app

EXPOSE 8005

# The entrypoint waits for MySQL, migrates and (optionally) seeds before exec'ing
# this command.
#
# `--host=0.0.0.0` is required for host/mobile access.
# `--no-reload` is also required: `artisan serve` only forwards a small
# allow-list of env vars to its child PHP process when a .env file exists, so
# the compose environment (DB_HOST=db etc.) would be dropped and the bind-mounted
# .env would win. --no-reload forwards the whole environment instead. The only
# thing it turns off is restarting the server when .env changes.
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8005", "--no-reload"]

# -----------------------------------------------------------------------------
# Stage 4 — production
#
# One container runs nginx (public/ static + FastCGI) and php-fpm. The task
# asked for a real web server rather than `php artisan serve`; co-locating both
# processes avoids having to share the app volume with a second nginx service.
# -----------------------------------------------------------------------------
FROM base AS production

ENV APP_ENV=production \
    APP_DEBUG=false

# nginx serves the app, supervisord keeps nginx and php-fpm alive side by side.
RUN apk add --no-cache nginx supervisor

# Production dependencies and the fully-optimised autoloader.
COPY --from=vendor /var/www/html/vendor ./vendor

COPY . .

RUN composer dump-autoload \
        --no-dev \
        --optimize \
        --classmap-authoritative \
        --no-interaction \
    && mkdir -p \
        storage/framework/cache/data \
        storage/framework/sessions \
        storage/framework/views \
        storage/logs \
        bootstrap/cache \
    && chown -R app:app storage bootstrap/cache \
    && chmod -R ug+rwX storage bootstrap/cache

# php-fpm pool that tracks the non-root `app` user and passes container env
# through to the workers (Laravel reads DB_* / SANCTUM_* from the environment).
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/zz-cvo.conf
COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/supervisord.conf /etc/supervisord.conf

EXPOSE 8080

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
