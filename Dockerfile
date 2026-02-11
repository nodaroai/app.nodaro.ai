# ── Stage 1: Build backend ────────────────────────────────────────────
FROM node:20-alpine AS backend-builder

RUN apk add --no-cache libc6-compat

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

# Start backend
cd /app/backend
node dist/server.js &
BACKEND_PID=$!

# Start frontend (Next.js standalone server)
cd /app/frontend
PORT=3000 HOSTNAME=0.0.0.0 node server.js &
FRONTEND_PID=$!

# Wait for either to exit
wait -n $BACKEND_PID $FRONTEND_PID
EXIT_CODE=$?

# If one exits, stop the other
kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
exit $EXIT_CODE
EOF

RUN chmod +x /app/start.sh

EXPOSE 3000 8000

CMD ["/app/start.sh"]
