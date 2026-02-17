# ── Stage 1: Build backend ────────────────────────────────────────────
FROM node:20-alpine AS backend-builder

RUN apk add --no-cache libc6-compat python3

ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ── Stage 2: Build frontend ──────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

RUN apk add --no-cache libc6-compat

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./

# Vite inlines VITE_* env vars at build time
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_APP_URL
ARG VITE_API_URL
ARG VITE_EDITION
ARG VITE_PADDLE_CLIENT_TOKEN
ARG VITE_PADDLE_ENVIRONMENT

RUN npm run build

# ── Stage 3: Production runner ───────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat ffmpeg caddy

ENV NODE_ENV=production

WORKDIR /app

# Backend: compiled JS + production dependencies
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/package.json ./backend/package.json

# Frontend: Vite static build + Caddy config
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY frontend/Caddyfile /etc/caddy/Caddyfile

# Startup script: run backend + worker + Caddy concurrently
COPY <<'EOF' /app/start.sh
#!/bin/sh

# Railway injects PORT=8080 at runtime for routing
echo "Starting with PORT=${PORT:-8080}"

# Start backend API server on fixed internal port
cd /app/backend
PORT=9000 node dist/server.js &

# Start BullMQ worker (job processor)
node dist/worker.js &

# Start Caddy as main process (PID 1 for signal handling)
cd /app
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
EOF

RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
