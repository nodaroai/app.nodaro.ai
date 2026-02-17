# ── Stage 1: Build backend ─────────────────────────────────────────
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

# Vite inlines env vars at build time. Railway doesn't pass Docker build args,
# so we use placeholders that get replaced at container startup with real values.
ENV VITE_SUPABASE_URL=__VITE_SUPABASE_URL__
ENV VITE_SUPABASE_ANON_KEY=__VITE_SUPABASE_ANON_KEY__
ENV VITE_APP_URL=__VITE_APP_URL__
ENV VITE_API_URL=
ENV VITE_EDITION=__VITE_EDITION__
ENV VITE_PADDLE_CLIENT_TOKEN=__VITE_PADDLE_CLIENT_TOKEN__
ENV VITE_PADDLE_ENVIRONMENT=__VITE_PADDLE_ENVIRONMENT__

RUN npm run build

# ── Stage 3: Production runner ───────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat ffmpeg caddy curl

ENV NODE_ENV=production

WORKDIR /app

# Backend: compiled JS + production dependencies
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/package.json ./backend/package.json

# Frontend: Vite static build + Caddy config
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY frontend/Caddyfile /etc/caddy/Caddyfile

# Startup script: replace Vite placeholders, run backend + worker + Caddy
COPY <<'EOF' /app/start.sh
#!/bin/sh

echo "Starting with PORT=${PORT:-3000}"

# Fall back to NEXT_PUBLIC_* vars if VITE_* not set (Railway migration)
VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-$NEXT_PUBLIC_SUPABASE_URL}"
VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-$NEXT_PUBLIC_SUPABASE_ANON_KEY}"
VITE_APP_URL="${VITE_APP_URL:-$NEXT_PUBLIC_APP_URL}"
VITE_EDITION="${VITE_EDITION:-$NEXT_PUBLIC_EDITION}"
VITE_PADDLE_CLIENT_TOKEN="${VITE_PADDLE_CLIENT_TOKEN:-$NEXT_PUBLIC_PADDLE_CLIENT_TOKEN}"
VITE_PADDLE_ENVIRONMENT="${VITE_PADDLE_ENVIRONMENT:-$NEXT_PUBLIC_PADDLE_ENVIRONMENT}"

# Debug: show which vars are available
echo "ENV CHECK: VITE_SUPABASE_URL=${#VITE_SUPABASE_URL}chars VITE_EDITION=${VITE_EDITION}"

# Replace Vite build-time placeholders with actual runtime env vars
echo "Injecting runtime env vars into frontend..."
for f in /app/frontend/dist/assets/*.js; do
  [ -f "$f" ] || continue
  sed -i \
    -e "s|__VITE_SUPABASE_URL__|${VITE_SUPABASE_URL}|g" \
    -e "s|__VITE_SUPABASE_ANON_KEY__|${VITE_SUPABASE_ANON_KEY}|g" \
    -e "s|__VITE_APP_URL__|${VITE_APP_URL}|g" \
    -e "s|__VITE_EDITION__|${VITE_EDITION}|g" \
    -e "s|__VITE_PADDLE_CLIENT_TOKEN__|${VITE_PADDLE_CLIENT_TOKEN}|g" \
    -e "s|__VITE_PADDLE_ENVIRONMENT__|${VITE_PADDLE_ENVIRONMENT}|g" \
    "$f"
done

# Start backend API server on fixed internal port
cd /app/backend
PORT=9000 node dist/server.js &

# Start BullMQ worker (job processor)
node dist/worker.js &

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
