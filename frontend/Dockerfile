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
# =============================================================================

ARG NODE_VERSION=20

# -----------------------------------------------------------------------------
# Dependencies
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
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
COPY . .

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
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Production runtime
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS production

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine's default entrypoint/cmd already runs nginx in the foreground.
