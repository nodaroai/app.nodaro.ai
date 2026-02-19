# ── Stage 1: Build backend ────────────────────────────────────────────
FROM node:20-alpine AS backend-builder

RUN apk add --no-cache libc6-compat python3

ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ── Stage 2: Install Remotion package deps ─────────────────────────────
FROM node:20-alpine AS remotion-builder

RUN apk add --no-cache libc6-compat

WORKDIR /app/packages/remotion
COPY packages/remotion/package*.json ./
RUN npm ci
COPY packages/remotion/ ./

# ── Stage 3: Build frontend ──────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

RUN apk add --no-cache libc6-compat

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./

# Railway passes service variables as Docker build args.
# Vite inlines VITE_* env vars at build time.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_APP_URL
ARG VITE_EDITION
ARG VITE_PADDLE_CLIENT_TOKEN
ARG VITE_PADDLE_ENVIRONMENT

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_APP_URL=$VITE_APP_URL
ENV VITE_API_URL=
ENV VITE_EDITION=$VITE_EDITION
ENV VITE_PADDLE_CLIENT_TOKEN=$VITE_PADDLE_CLIENT_TOKEN
ENV VITE_PADDLE_ENVIRONMENT=$VITE_PADDLE_ENVIRONMENT

RUN npm run build

# ── Stage 4: Production runner ───────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat ffmpeg caddy curl

ENV NODE_ENV=production

WORKDIR /app

# Backend: compiled JS + production dependencies
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/package.json ./backend/package.json

# Remotion: source + node_modules (bundled at runtime by @remotion/bundler)
COPY --from=remotion-builder /app/packages/remotion ./packages/remotion

# Frontend: Vite static build + Caddy config
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY frontend/Caddyfile /etc/caddy/Caddyfile

# Startup script: run backend + worker + Caddy
COPY <<'EOF' /app/start.sh
#!/bin/sh

echo "Starting with PORT=${PORT:-3000}"

# Start backend API server on fixed internal port
cd /app/backend
PORT=9000 node dist/server.js &

# Start BullMQ worker (job processor)
node dist/worker.js &

# Start BullMQ render worker (Remotion video rendering)
node dist/render-worker.js &

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

CMD ["/app/start.sh"]
