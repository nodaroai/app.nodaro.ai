# ── Stage 1: Build backend ────────────────────────────────────────────
FROM node:22-alpine AS backend-builder

RUN apk add --no-cache libc6-compat python3

ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
ENV YOUTUBE_DL_SKIP_DOWNLOAD=1

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./

# Shared package needed by backend (relative imports from payload-builder.ts)
COPY packages/shared/ /app/packages/shared/

RUN npm run build

# ── Stage 2: Install Remotion package deps ─────────────────────────────
FROM node:22-alpine AS remotion-builder

RUN apk add --no-cache libc6-compat

WORKDIR /app/packages/remotion
COPY packages/remotion/package*.json ./
RUN npm ci
COPY packages/remotion/ ./

# ── Stage 3: Build frontend ──────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

RUN apk add --no-cache libc6-compat

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./

# Remotion package source + deps needed for @remotion-pkg TypeScript path alias
COPY --from=remotion-builder /app/packages/remotion/src /app/packages/remotion/src
COPY --from=remotion-builder /app/packages/remotion/node_modules /app/packages/remotion/node_modules

# Shared package source needed for @nodaro-shared Vite alias
COPY packages/shared/src /app/packages/shared/src

# Railway passes service variables as Docker build args.
# Vite inlines VITE_* env vars at build time.
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

RUN npm run build

# ── Stage 4: Production runner ───────────────────────────────────────
# Debian slim (glibc) — required for Remotion's chrome-headless-shell binary.
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

# Backend: compiled JS + production dependencies
COPY --chown=node:node --from=backend-builder /app/backend/dist ./backend/dist
COPY --chown=node:node --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --chown=node:node --from=backend-builder /app/backend/package.json ./backend/package.json

# Remotion: source + node_modules (bundled at runtime by @remotion/bundler)
COPY --chown=node:node --from=remotion-builder /app/packages/remotion ./packages/remotion

# Frontend: Vite static build + Caddy config
COPY --chown=node:node --from=frontend-builder /app/frontend/dist ./frontend/dist
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
PORT=$BACKEND_PORT node dist/backend/src/server.js &

# Start BullMQ worker (job processor)
node dist/backend/src/worker.js &

# Start BullMQ render worker (Remotion video rendering)
node dist/backend/src/render-worker.js &

# Start BullMQ orchestrator worker (workflow execution)
node dist/backend/src/orchestrator.js &

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
