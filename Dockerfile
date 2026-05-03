# syntax=docker/dockerfile:1.6
# ── Stage 1: Install workspace deps ───────────────────────────────────
# Runs `npm ci` once at the workspace root so all packages share a
# single hoisted node_modules tree (with @nodaro/shared symlinked into
# root node_modules/@nodaro/shared → ../../packages/shared).
FROM node:22-alpine AS deps

RUN apk add --no-cache libc6-compat python3

# node:22-alpine ships with npm 10.9.x which has stricter lockfile
# validation than npm 11. Our package-lock.json was generated with
# npm 11 (which respects root `overrides` differently), so we use
# corepack to pin npm@11 inside the build image.
RUN corepack enable npm && corepack prepare npm@11.12.1 --activate

ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
ENV YOUTUBE_DL_SKIP_DOWNLOAD=1

WORKDIR /app

# Copy ONLY package manifests first to maximise Docker layer caching.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/client/package.json ./packages/client/
COPY packages/remotion/package.json ./packages/remotion/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install all workspaces (incl. dev deps — needed for tsc/tsup/vite builds).
RUN npm ci

# ── Stage 2: Build @nodaro/shared (tsup) ──────────────────────────────
FROM deps AS shared-build

WORKDIR /app
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/tsup.config.ts ./packages/shared/

WORKDIR /app/packages/shared
RUN npm run build

# ── Stage 2b: Build @nodaro/client (tsup) ─────────────────────────────
# Frontend imports @nodaro/client from node_modules (workspace symlink).
# Client depends on @nodaro/shared, so shared/dist must be in place first.
FROM deps AS client-build

WORKDIR /app
COPY --from=shared-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-build /app/packages/shared/package.json ./packages/shared/package.json

COPY packages/client/src ./packages/client/src
COPY packages/client/tsconfig.json ./packages/client/
COPY packages/client/tsup.config.ts ./packages/client/

WORKDIR /app/packages/client
RUN npm run build

# ── Stage 3: Build backend (tsc) ──────────────────────────────────────
# Backend imports @nodaro/shared by package name. Resolution walks from
# backend/src/* up to /app/node_modules/@nodaro/shared (workspace symlink
# created by stage 1's `npm ci`), then through packages/shared/package.json
# main/module fields → packages/shared/dist/index.{cjs,js}.
FROM deps AS backend-build

WORKDIR /app
# Bring in the freshly built shared dist so the symlinked package resolves.
COPY --from=shared-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-build /app/packages/shared/package.json ./packages/shared/package.json

# Backend source.
COPY backend/ ./backend/

WORKDIR /app/backend
# Skip the `prebuild` lifecycle hook (which would re-run tsup against
# packages/shared/src — but src isn't copied to this stage; the prebuilt
# dist is already in place from shared-build above).
RUN npx tsc

# ── Stage 4: Build frontend (vite) ────────────────────────────────────
# Vite resolves @nodaro/shared via the same workspace symlink. The
# @remotion-pkg alias resolves to packages/remotion/src directly.
FROM deps AS frontend-build

WORKDIR /app
# Shared dist (Vite imports it as @nodaro/shared from package main/module).
COPY --from=shared-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-build /app/packages/shared/package.json ./packages/shared/package.json

# i18n sidecars: frontend/src/lib/i18n-bootstrap.ts uses
# import.meta.glob("../../../packages/shared/src/i18n/*.*.ts") so Vite can
# code-split each locale into its own chunk. tsup bundles everything into
# dist/index.js without preserving the per-file split, so the source files
# must be present here for the glob to match.
COPY packages/shared/src/i18n ./packages/shared/src/i18n

# Client dist (Vite imports @nodaro/client via workspace symlink → dist).
COPY --from=client-build /app/packages/client/dist ./packages/client/dist
COPY --from=client-build /app/packages/client/package.json ./packages/client/package.json

# Remotion package source (Vite alias `@remotion-pkg` points at src/).
COPY packages/remotion/ ./packages/remotion/

# Frontend source.
COPY frontend/ ./frontend/

# Railway passes service variables as Docker build args. Vite inlines
# VITE_* env vars at build time, so they MUST be defined here.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_APP_URL
ARG VITE_API_URL
ARG VITE_EDITION
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_FREECUT_URL
ARG VITE_AUDIOMASS_URL

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_APP_URL=$VITE_APP_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_EDITION=$VITE_EDITION
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_FREECUT_URL=$VITE_FREECUT_URL
ENV VITE_AUDIOMASS_URL=$VITE_AUDIOMASS_URL

WORKDIR /app/frontend
# Skip the `prebuild` lifecycle hook (would re-run tsup for shared+client
# but src dirs aren't copied; prebuilt dists are already in place).
# Skip `tsc --noEmit` here too — npm's hoisting in this Docker layer
# can produce duplicate copies of peer-dep packages (e.g. @tiptap/core
# in both /app/node_modules and /app/frontend/node_modules), which tsc
# treats as distinct types. Vite's resolver dedupes correctly. Type
# errors are caught by CI's typecheck job, not the Docker build.
RUN npx vite build

# ── Stage 5: Production runtime deps ──────────────────────────────────
# Re-run `npm ci` with --omit=dev so the runner only ships production
# packages. Crucially, this MUST use the same OS/libc as the runner
# (node:22-slim → glibc) so platform-specific native deps (sharp,
# @img/sharp-libvips-*) install the correct linux-arm64/linux-x64
# binaries rather than the alpine-musl variants used by the build
# stages above.
FROM node:22-slim AS prod-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Match the npm version used in the deps stage (see comment in stage 1)
# so `npm ci --omit=dev` can read the same lockfile.
RUN corepack enable npm && corepack prepare npm@11.12.1 --activate

ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
ENV YOUTUBE_DL_SKIP_DOWNLOAD=1

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/client/package.json ./packages/client/
COPY packages/remotion/package.json ./packages/remotion/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci --omit=dev

# Ensure backend/node_modules exists even if all backend deps got hoisted
# to the root (avoids COPY failures in the runner stage).
RUN mkdir -p /app/backend/node_modules

# ── Stage 6: Production runner ────────────────────────────────────────
# Debian slim (glibc) — required for Remotion's chrome-headless-shell.
# Alpine (musl) is incompatible with Chrome/Chromium glibc binaries.
FROM node:22-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl ca-certificates yt-dlp \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libatspi2.0-0 \
    fonts-dejavu-core fonts-liberation fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && ARCH=$(dpkg --print-architecture) \
    && curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${ARCH}" -o /usr/bin/caddy \
    && chmod +x /usr/bin/caddy

# Create non-root user (node:22-slim already has uid 1000 node user, || true for safety)
RUN groupadd --gid 1000 node || true \
    && useradd --uid 1000 --gid node --shell /bin/bash --create-home node || true

ENV NODE_ENV=production

WORKDIR /app

# 1. Workspace manifests (so Node's resolver sees the workspace layout).
COPY --chown=node:node --from=prod-deps /app/package.json ./package.json
COPY --chown=node:node --from=prod-deps /app/package-lock.json ./package-lock.json

# 2. Hoisted production node_modules (incl. @nodaro/shared workspace
#    symlink → ../../packages/shared). Docker COPY preserves symlinks
#    when the source is a directory tree containing them.
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules

# 3. Workspace package manifests (so Node's resolver knows the layout).
COPY --chown=node:node --from=prod-deps /app/packages/shared/package.json ./packages/shared/package.json
COPY --chown=node:node --from=prod-deps /app/packages/remotion/package.json ./packages/remotion/package.json
COPY --chown=node:node --from=prod-deps /app/backend/package.json ./backend/package.json
COPY --chown=node:node --from=prod-deps /app/frontend/package.json ./frontend/package.json

# 3b. Backend's nested node_modules — npm hoists most packages to the
#     root, but some (e.g. backend's stripe@20) get nested under
#     backend/ when version constraints conflict with another workspace.
#     The frontend nested node_modules is not copied: frontend is shipped
#     as static vite-built assets, not a Node runtime, so its deps aren't
#     needed. (Remotion has no version conflicts thanks to root react@19
#     overrides, so its node_modules is empty in prod-deps.)
COPY --chown=node:node --from=prod-deps /app/backend/node_modules ./backend/node_modules

# 4. Built @nodaro/shared dist (resolved via the workspace symlink).
COPY --chown=node:node --from=shared-build /app/packages/shared/dist ./packages/shared/dist

# 5. Backend compiled JS (flat dist/server.js because tsconfig rootDir = ./src).
COPY --chown=node:node --from=backend-build /app/backend/dist ./backend/dist

# 6. Remotion package source — bundled at runtime by @remotion/bundler.
COPY --chown=node:node --from=frontend-build /app/packages/remotion/src ./packages/remotion/src
COPY --chown=node:node --from=frontend-build /app/packages/remotion/tsconfig.json ./packages/remotion/tsconfig.json

# 7. Frontend Vite static build + Caddy config.
COPY --chown=node:node --from=frontend-build /app/frontend/dist ./frontend/dist
COPY frontend/Caddyfile /etc/caddy/Caddyfile

# Startup script: run backend + worker + Caddy
COPY <<'EOF' /app/start.sh
#!/bin/sh

echo "Starting with PORT=${PORT:-3000}"

# Generate an internal orchestrator secret if not provided so every
# sibling process in this container inherits the SAME value. Required
# for orchestrator → API auth; without it, the auth hook rejects
# internal calls (since the IP-based check has been removed).
if [ -z "$INTERNAL_ORCHESTRATOR_SECRET" ]; then
  export INTERNAL_ORCHESTRATOR_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "Generated INTERNAL_ORCHESTRATOR_SECRET (set the env var to persist across restarts)"
fi

# Start backend API server on fixed internal port
cd /app/backend
export BACKEND_PORT=9000
PORT=$BACKEND_PORT node dist/server.js &

# Start BullMQ worker (job processor)
node dist/worker.js &

# Start BullMQ render worker (Remotion video rendering)
node dist/render-worker.js &

# Start BullMQ orchestrator worker (workflow execution)
node dist/orchestrator.js &

# Wait for backend to be ready before accepting traffic
echo "Waiting for backend on port 9000..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:9000/health > /dev/null 2>&1; then
    echo "Backend is ready"
    break
  fi
  sleep 1
done

# Start Caddy as main process (PID 1 for signal handling)
cd /app
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
EOF

RUN chmod +x /app/start.sh

USER node

CMD ["/app/start.sh"]
