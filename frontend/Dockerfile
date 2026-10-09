# syntax=docker/dockerfile:1.7

# =============================================================================
# CVO Frontend — multi-stage image (React 19 + Vite 8)
#
#   deps        npm ci from package-lock.json
#   dev         node:20-alpine running `vite --host 0.0.0.0` (HMR)
#   build       production bundle (vite build)
#   production  nginx:alpine serving dist/ with an SPA fallback, plus a
#               reverse proxy for /api, /sanctum and /storage
#
# IMPORTANT — VITE_API_URL is a BUILD-time variable for the production target.
# Vite inlines import.meta.env.* into the JavaScript bundle at build time, so
# the URL must be known while `vite build` runs; passing it at container
# runtime does nothing. The dev target is different — Vite's dev server reads
# the variable at runtime, which is why docker-compose.yml passes it as an
# environment variable there.
#
# BUILD CONTEXT = REPOSITORY ROOT
#   Every COPY below is prefixed `frontend/` because the context is the repo
#   root, not frontend/. That is Render's default (`dockerContext` is omitted
#   from render.yaml) and it is what the compose files now pass explicitly
#   (`context: .` + `dockerfile: frontend/Dockerfile`). Building this file with
#   a frontend/ context will fail — use `docker build -f frontend/Dockerfile .`
# =============================================================================

ARG NODE_VERSION=20

# -----------------------------------------------------------------------------
# Dependencies
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# Development
#
# Source and node_modules are bind-mounted in compose (node_modules via a named
# volume), so the copies below are just a fallback for `docker run`.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ .

EXPOSE 5173
# Container must listen on 0.0.0.0 for the host to reach it. strictPort is set
# in vite.config.js so the port cannot silently change (Sanctum is origin-locked).
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# -----------------------------------------------------------------------------
# Production build
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

# Empty default => the SPA calls the API on its own origin (single-origin
# deployment). docker-compose.prod.yml sets VITE_API_URL="" for that reason and
# the bundled nginx reverse-proxies to the backend. Set an absolute URL here
# only when the API lives on a different origin.
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ .
RUN npm run build

# -----------------------------------------------------------------------------
# Production runtime
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS production

# envsubst template, NOT a finished config: nginx:alpine's
# /docker-entrypoint.d/20-envsubst-on-templates.sh renders it to
# /etc/nginx/conf.d/default.conf at container start. Copying the file straight
# into conf.d would leave ${BACKEND_UPSTREAM} literal and nginx would refuse to
# boot wherever the host `backend` does not resolve (i.e. on Render):
#     [emerg] host not found in upstream "backend"
COPY frontend/docker/nginx.conf.template /etc/nginx/templates/default.conf.template

# Upstream for the /api, /sanctum, /storage and /up proxies. The default
# resolves everywhere (no DNS lookup needed — /etc/hosts), so the container
# boots on Render with no dashboard config. docker-compose.prod.yml overrides
# it to http://backend:8080 to keep the single-origin proxy.
ENV BACKEND_UPSTREAM=http://localhost:8080

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine's default entrypoint/cmd already runs nginx in the foreground.
