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
COPY packages/prompts/package.json ./packages/prompts/
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

# @nodaro/prompts (private, SUL) — depends on @nodaro/shared dist.
WORKDIR /app
COPY packages/prompts/src ./packages/prompts/src
COPY packages/prompts/tsconfig.json ./packages/prompts/
COPY packages/prompts/tsup.config.ts ./packages/prompts/
WORKDIR /app/packages/prompts
RUN npm run build

# ── Stage 2b: Build @nodaro/sdk (tsup) ─────────────────────────────
# Frontend imports @nodaro/sdk from node_modules (workspace symlink).
# Client depends on @nodaro/shared, so shared/dist must be in place first.
FROM deps AS client-build

WORKDIR /app
COPY --from=shared-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=shared-build /app/packages/prompts/dist ./packages/prompts/dist
COPY --from=shared-build /app/packages/prompts/package.json ./packages/prompts/package.json

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
COPY --from=shared-build /app/packages/prompts/dist ./packages/prompts/dist
COPY --from=shared-build /app/packages/prompts/package.json ./packages/prompts/package.json

# Backend source.
COPY backend/ ./backend/

WORKDIR /app/backend
# Skip the `prebuild` lifecycle hook (which would re-run tsup against
# packages/shared/src — but src isn't copied to this stage; the prebuilt
# dist is already in place from shared-build above).
# Use tsconfig.build.json (rootDir=./src, emit on, tests excluded). The
# top-level tsconfig.json is the noEmit typecheck config — see
# backend/scripts/lib/gen-skills/ which is part of typecheck scope but
# not part of the production build.
RUN npx tsc -p tsconfig.build.json

# ── Stage 4: Build frontend (vite) ────────────────────────────────────
# Vite resolves @nodaro/shared via the same workspace symlink. The
# @remotion-pkg alias resolves to packages/remotion/src directly.
FROM deps AS frontend-build

WORKDIR /app
# Shared dist (Vite imports it as @nodaro/shared from package main/module).
COPY --from=shared-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=shared-build /app/packages/prompts/dist ./packages/prompts/dist
COPY --from=shared-build /app/packages/prompts/package.json ./packages/prompts/package.json

# i18n sidecars: frontend/src/lib/i18n-bootstrap.ts uses
# import.meta.glob("../../../packages/shared/src/i18n/*.*.ts") so Vite can
# code-split each locale into its own chunk. tsup bundles everything into
# dist/index.js without preserving the per-file split, so the source files
# must be present here for the glob to match.
COPY packages/shared/src/i18n ./packages/shared/src/i18n

# Client dist (Vite imports @nodaro/sdk via workspace symlink → dist).
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
ARG VITE_API_URL
ARG VITE_EDITION
ARG VITE_FREECUT_URL
ARG VITE_AUDIOMASS_URL
ARG VITE_STUDIO_URL
# Optional analytics + owner gate (empty = disabled; self-host default)
ARG VITE_GA_ID
ARG VITE_CLARITY_ID
ARG VITE_PLATFORM_OWNER_EMAIL
# Delta-save protocol rollout flag (P3): "1" enables; empty = full saves.
ARG VITE_DELTA_SAVES
# Image reference-prompt format ("hybrid" | "legacy"); empty = legacy in prod.
ARG VITE_IMAGE_REFERENCE_FORMAT

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_EDITION=$VITE_EDITION
ENV VITE_FREECUT_URL=$VITE_FREECUT_URL
ENV VITE_AUDIOMASS_URL=$VITE_AUDIOMASS_URL
ENV VITE_STUDIO_URL=$VITE_STUDIO_URL
ENV VITE_GA_ID=$VITE_GA_ID
ENV VITE_DELTA_SAVES=$VITE_DELTA_SAVES
ENV VITE_CLARITY_ID=$VITE_CLARITY_ID
ENV VITE_PLATFORM_OWNER_EMAIL=$VITE_PLATFORM_OWNER_EMAIL
ENV VITE_IMAGE_REFERENCE_FORMAT=$VITE_IMAGE_REFERENCE_FORMAT

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
COPY packages/prompts/package.json ./packages/prompts/
COPY packages/client/package.json ./packages/client/
COPY packages/remotion/package.json ./packages/remotion/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci --omit=dev

# Ensure backend/node_modules exists even if all backend deps got hoisted
# to the root (avoids COPY failures in the runner stage).
RUN mkdir -p /app/backend/node_modules

# Built @nodaro/shared dist, mirroring the runner stage's own COPY: npm
# dedupes the private plugin's `@nodaro/shared` dependency onto the workspace
# symlink (node_modules/@nodaro/shared -> ../packages/shared), which in THIS
# stage otherwise holds only package.json — the plugin import-smoke below
# then fails on a missing dist even though the runner image resolves it fine
# (staging deploy 7eccf973 failed exactly here). Copying the dist makes the
# smoke exercise the same resolution path production uses.
COPY --from=shared-build /app/packages/shared/dist ./packages/shared/dist

# Optional Cloud-only private plugin (@nodaroai/cloud-plugins, proprietary —
# see backend/src/lib/private-plugins/load.ts). This MUST install in THIS
# stage, not `backend-build`: the runner stage below copies its shipped
# node_modules from prod-deps (`COPY --from=prod-deps /app/node_modules` +
# `.../backend/node_modules`), never from `backend-build`. Installing it in
# `backend-build` instead would compile fine — the loader only ever
# references the package name as a runtime string, never a static import tsc
# could see — but the package would silently never reach the running
# container.
#
# NPM_TOKEN/CLOUD_PLUGINS_VERSION are unset for every self-hosted/community
# build and for public CI, so the `if` body never runs: no .npmrc is
# created, no extra install happens, and node_modules stays byte-identical
# to before this block existed. Railway's Cloud build supplies both as
# Docker build args (a GitHub Packages read token scoped to
# nodaroai/cloud-plugins + the pinned release version). The .npmrc write,
# install, import-smoke check, and cleanup all run in ONE RUN instruction
# (one layer) so the token-bearing file is never present in any committed
# layer. `--no-save` keeps package.json/package-lock.json untouched, same as
# every other install in this stage.
ARG NPM_TOKEN
ARG CLOUD_PLUGINS_VERSION
# NOTE: read NPM_TOKEN via `$(printenv NPM_TOKEN)`, NOT `${NPM_TOKEN}`. A build
# ARG referenced as `$VAR`/`${VAR}` is substituted by the Dockerfile frontend
# INTO the command string BuildKit prints, so with Railway's plain build logs
# the token would leak in plaintext. The ARG is also exported to the RUN shell
# env, and BuildKit does not touch `$(...)` command substitution — so this reads
# the same value at runtime while the printed command stays `$(printenv …)`.
# CLOUD_PLUGINS_VERSION is just a version string; leaving it substituted is fine.
RUN if [ -n "$(printenv NPM_TOKEN)" ]; then \
      echo "@nodaroai:registry=https://npm.pkg.github.com" > .npmrc && \
      echo "//npm.pkg.github.com/:_authToken=$(printenv NPM_TOKEN)" >> .npmrc && \
      npm install --no-save "@nodaroai/cloud-plugins@${CLOUD_PLUGINS_VERSION}" && \
      node -e "import('@nodaroai/cloud-plugins').then(m=>{if(m.contractVersion!==1){console.error('plugin smoke: contractVersion mismatch:',m.contractVersion);process.exit(1)}}).catch(e=>{console.error('plugin smoke failed:',e&&e.message);process.exit(1)})" && \
      rm -f .npmrc; \
    fi

# ── Stage 6: Production runner ────────────────────────────────────────
# Debian slim (glibc) — required for Remotion's chrome-headless-shell.
# Alpine (musl) is incompatible with Chrome/Chromium glibc binaries.
FROM node:22-slim AS runner

# ffmpeg is PINNED — to an exact static build, by URL + SHA256, per arch.
# Rendered audio/video output is ffmpeg-version-dependent: the 5.1→8 upgrade
# alone changed afir's gain MECHANISM (ffmpeg 8's new `irnorm` option defaults
# to ℓ1-normalizing the IR — it would have silently crushed every reverb's wet
# leg by 20–37 dB had the characterization harness + the runtime wet-leg
# compensation in backend/src/providers/video/audio-fx.ts not caught it). An
# unpinned install would let a base-image rebuild change what every customer
# render sounds/looks like with zero code change and zero review.
#
# These are BtbN/FFmpeg-Builds release assets from a DATED tag — immutable and
# checksum-verified, so the build is deterministic forever (unlike an apt pin,
# which Debian's archive eventually drops). Bumping them is a deliberate
# ffmpeg upgrade: re-bless the characterization goldens inside the new image
# (backend/scripts/characterize-in-image.sh bless), review the per-metric
# `npm run characterize:report` diff, update DEFAULT_GOLDEN_FILE
# (backend/src/providers/video/__characterization__/golden.ts), and ship it
# all in ONE PR. The characterize CI job and characterize-in-image.sh install
# the same tarball via the SAME script (tools/install-pinned-ffmpeg.sh, which
# also owns the ARG parsing) — a procedure change lands everywhere at once,
# and a pin mismatch fails the suite's version guard loudly.
ARG FFMPEG_TARBALL_URL_AMD64=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-12-13-16/ffmpeg-n8.1.2-22-g94138f6973-linux64-gpl-8.1.tar.xz
ARG FFMPEG_TARBALL_SHA256_AMD64=516b60bad3df2dedea23594c60e7afaecf3e6a440ca9091ef95ee1f62deba71e
ARG FFMPEG_TARBALL_URL_ARM64=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-12-13-16/ffmpeg-n8.1.2-22-g94138f6973-linuxarm64-gpl-8.1.tar.xz
ARG FFMPEG_TARBALL_SHA256_ARM64=0a34477fb47a9c108b869fccc9919e00d0c7ebf886e8d45301c74d2d46640d64
COPY tools/install-pinned-ffmpeg.sh /tmp/install-pinned-ffmpeg.sh
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates xz-utils \
    aubio-tools \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libatspi2.0-0 \
    fonts-dejavu-core fonts-liberation fontconfig \
    && case "$(dpkg --print-architecture)" in \
         amd64) FFMPEG_TARBALL_URL="${FFMPEG_TARBALL_URL_AMD64}"; FFMPEG_TARBALL_SHA256="${FFMPEG_TARBALL_SHA256_AMD64}" ;; \
         arm64) FFMPEG_TARBALL_URL="${FFMPEG_TARBALL_URL_ARM64}"; FFMPEG_TARBALL_SHA256="${FFMPEG_TARBALL_SHA256_ARM64}" ;; \
         *) echo "unsupported arch for ffmpeg: $(dpkg --print-architecture)" >&2; exit 1 ;; \
       esac \
    && bash /tmp/install-pinned-ffmpeg.sh --url "${FFMPEG_TARBALL_URL}" --sha256 "${FFMPEG_TARBALL_SHA256}" \
    && rm -f /tmp/install-pinned-ffmpeg.sh \
    && rm -rf /var/lib/apt/lists/* \
    && ARCH=$(dpkg --print-architecture) \
    && curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${ARCH}" -o /usr/bin/caddy \
    && chmod +x /usr/bin/caddy

# yt-dlp — the OFFICIAL pinned static binary, NOT Debian's `yt-dlp` package.
#
# Two things were wrong before, and together they killed every social-video path
# (download-video, youtube-audio, trim-audio on a social URL, the analysis worker):
#
#  1. `YOUTUBE_DL_SKIP_DOWNLOAD=1` (set in deps AND prod-deps) tells
#     `youtube-dl-exec`'s postinstall NOT to fetch its binary — on purpose, since a
#     system yt-dlp was apt-installed instead. But nothing pointed the code at the
#     system one: it still spawned `node_modules/youtube-dl-exec/bin/yt-dlp`, which
#     therefore never existed. Every call died with ENOENT.
#  2. And the apt binary would not have saved us: Debian's `yt-dlp` is years out of
#     date and YouTube rejects it. Falling back to it would have traded one failure
#     for another.
#
# So: fetch the real thing, pin it, verify it runs at build time, and point
# `YOUTUBE_DL_DIR` at it — the env var `youtube-dl-exec` reads — so every caller
# (library-based and direct-spawn) resolves the SAME binary.
ARG YT_DLP_VERSION=2026.07.04
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) asset=yt-dlp_linux ;; \
      arm64) asset=yt-dlp_linux_aarch64 ;; \
      *) echo "unsupported arch for yt-dlp: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${asset}" \
      -o /usr/local/bin/yt-dlp; \
    chmod 0755 /usr/local/bin/yt-dlp; \
    /usr/local/bin/yt-dlp --version
ENV YOUTUBE_DL_DIR=/usr/local/bin

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
COPY --chown=node:node --from=prod-deps /app/packages/prompts/package.json ./packages/prompts/package.json
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
COPY --chown=node:node --from=shared-build /app/packages/prompts/dist ./packages/prompts/dist

# 5. Backend compiled JS (flat dist/server.js because tsconfig rootDir = ./src).
COPY --chown=node:node --from=backend-build /app/backend/dist ./backend/dist

# 5b. Backend skill content (markdown files read by MCP skill-loader tools).
#     Whitelisted in .dockerignore so they enter the build context; this COPY
#     pulls them into the runner stage. The skill-loaders module reads them
#     at module-load time via import.meta.url path resolution.
COPY --chown=node:node --from=backend-build /app/backend/skills ./backend/skills

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

# Supervised process runner: the queue consumers below are background
# siblings with Caddy as PID 1 — without supervision, a crashed worker
# (e.g. OOM-killed during a render burst) stays dead while /health keeps
# serving 200 from server.js (incident 2026-06-11: orchestrator + worker
# died at ~21:08/21:12 UTC, queues froze for 10h, container stayed green).
# 10s backoff prevents a hot crash-loop; the loop dies with the container.
supervise() {
  name="$1"; shift
  while :; do
    "$@"
    code=$?
    echo "[supervise] $name exited (code $code) — restarting in 10s"
    sleep 10
  done
}

# Start BullMQ worker (job processor)
supervise worker node dist/worker.js &

# Start BullMQ render worker (Remotion video rendering)
supervise render-worker node dist/render-worker.js &

# Start BullMQ orchestrator worker (workflow execution)
supervise orchestrator node dist/orchestrator.js &

# Start BullMQ pipeline worker (Story-to-Video orchestration).
# Cloud-only — exits cleanly on non-cloud editions so the same image runs
# for self-hosted Community/Business builds; the supervisor would restart
# that clean exit too, so gate it: only supervise when EDITION=cloud.
if [ "$EDITION" = "cloud" ]; then
  supervise pipeline-worker node dist/pipeline-worker.js &
else
  node dist/pipeline-worker.js &
fi

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
