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

# Railway passes env vars as build args -- expose NEXT_PUBLIC_* at build time
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_EDITION
ARG NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
ARG NEXT_PUBLIC_PADDLE_ENVIRONMENT
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_EDITION=$NEXT_PUBLIC_EDITION
ENV NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=$NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
ENV NEXT_PUBLIC_PADDLE_ENVIRONMENT=$NEXT_PUBLIC_PADDLE_ENVIRONMENT

# Next.js standalone build (output: "standalone" in next.config.ts)
RUN npm run build

# ── Stage 3: Production runner ───────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat ffmpeg

ENV NODE_ENV=production

WORKDIR /app

# Backend: compiled JS + production dependencies
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/package.json ./backend/package.json

# Frontend: Next.js standalone output + static assets
COPY --from=frontend-builder /app/frontend/.next/standalone ./frontend
COPY --from=frontend-builder /app/frontend/.next/static ./frontend/.next/static
COPY --from=frontend-builder /app/frontend/public ./frontend/public

# Startup script: run backend + frontend concurrently
# Backend on PORT 8000, frontend on PORT 3000
COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e

# Start backend API server
cd /app/backend
node dist/server.js &
BACKEND_PID=$!

# Start BullMQ worker (job processor)
node dist/worker.js &
WORKER_PID=$!

# Start frontend (Next.js standalone server)
cd /app/frontend
PORT=3000 HOSTNAME=0.0.0.0 node server.js &
FRONTEND_PID=$!

# Wait for any process to exit
wait -n $BACKEND_PID $WORKER_PID $FRONTEND_PID
EXIT_CODE=$?

# If one exits, stop the others
kill $BACKEND_PID $WORKER_PID $FRONTEND_PID 2>/dev/null || true
exit $EXIT_CODE
EOF

RUN chmod +x /app/start.sh

EXPOSE 3000 8000

CMD ["/app/start.sh"]
