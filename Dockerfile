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

# npm gives up on a slow registry far too early for a container build: the
# default is 2 retries with a 60s ceiling, and one transient stall then
# fails the whole image (hit on both ghcr publish attempts, and locally).
# These raise the retry budget only — a healthy network behaves identically,
# since nothing waits unless a request actually stalls.
ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
ENV NPM_CONFIG_FETCH_TIMEOUT=600000

WORKDIR /app

# Copy ONLY package manifests first to maximise Docker layer caching.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/prompts/package.json ./packages/prompts/
COPY packages/client/package.json ./packages/client/
COPY packages/remotion/package.json ./packages/remotion/
COPY packages/picker-ui/package.json ./packages/picker-ui/
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

# @nodaro/picker-ui (workspace, SUL, not published) — rich pickers, animated
# previews, and the @-mention prompt editor. One implementation for every
# edition (#748); depends on @nodaro/shared + @nodaro/prompts dists above.
WORKDIR /app
COPY packages/picker-ui/src ./packages/picker-ui/src
COPY packages/picker-ui/tsconfig.json ./packages/picker-ui/
COPY packages/picker-ui/tsup.config.ts ./packages/picker-ui/
WORKDIR /app/packages/picker-ui
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
# tsc emits JS only; copy-build-assets.mjs ships the runtime-read assets
# (tutorial-seed templates) into dist/ and FAILS the build if any are
# missing — without it every install boots with zero tutorials.
RUN npx tsc -p tsconfig.build.json && node scripts/copy-build-assets.mjs

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

# Picker-UI dist (Vite imports @nodaro/picker-ui via workspace symlink → dist;
# its CSS ships as dist/index.css, imported once by the frontend barrel).
COPY --from=shared-build /app/packages/picker-ui/dist ./packages/picker-ui/dist
COPY --from=shared-build /app/packages/picker-ui/package.json ./packages/picker-ui/package.json

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
# Deliberately without a default. The fallback now lives in the app
# (frontend/src/lib/runtime-config.ts -> DEFAULT_FREECUT_URL), so the published
# image stops baking a developer laptop's dev server, and an install repoints
# the editor at RUNTIME via FREECUT_URL instead of rebuilding (#767).
ARG VITE_FREECUT_URL
ARG VITE_AUDIOMASS_URL
ARG VITE_STUDIO_URL
ARG VITE_VOICE_URL
# Optional analytics + owner gate (empty = disabled; self-host default)
ARG VITE_GA_ID
ARG VITE_CLARITY_ID
ARG VITE_PLATFORM_OWNER_EMAIL
# Delta-save protocol rollout flag (P3): "1" enables; empty = full saves.
ARG VITE_DELTA_SAVES
# Image reference-prompt format ("hybrid" | "legacy"); empty = legacy in prod.
ARG VITE_IMAGE_REFERENCE_FORMAT
# The release version stamped on this image (community-image.yml passes the
# vX.Y.Z tag app-release put on the commit). Per-image and build-time on
# purpose — a version is a property of the build, unlike the runtime-
# overridable API/Supabase trio. Empty (local/dev builds) falls back to
# package.json in code.
ARG VITE_APP_VERSION
# Organizations (Cloud): "true" enables the organization surfaces. Empty =
# off, which is every self-host build and every build before the launch.
ARG VITE_ORGS_ENABLED

ENV VITE_ORGS_ENABLED=$VITE_ORGS_ENABLED
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_EDITION=$VITE_EDITION
ENV VITE_FREECUT_URL=$VITE_FREECUT_URL
ENV VITE_AUDIOMASS_URL=$VITE_AUDIOMASS_URL
ENV VITE_STUDIO_URL=$VITE_STUDIO_URL
ENV VITE_VOICE_URL=$VITE_VOICE_URL
ENV VITE_GA_ID=$VITE_GA_ID
ENV VITE_DELTA_SAVES=$VITE_DELTA_SAVES
ENV VITE_CLARITY_ID=$VITE_CLARITY_ID
ENV VITE_PLATFORM_OWNER_EMAIL=$VITE_PLATFORM_OWNER_EMAIL
ENV VITE_IMAGE_REFERENCE_FORMAT=$VITE_IMAGE_REFERENCE_FORMAT
ENV VITE_APP_VERSION=$VITE_APP_VERSION

# Fail the build when a REQUIRED VITE_* arg is empty.
#
# Vite INLINES VITE_* at build time, so an unset one still builds cleanly and
# ships a frontend that is silently wrong — the failure surfaces in someone's
# browser, far from the cause. The fork shipped exactly that.
#
# Only genuinely-unrecoverable args belong on this list. VITE_API_URL,
# VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_FREECUT_URL are
# deliberately ABSENT: start.sh writes /app/frontend/dist/config.js at boot and
# frontend/src/lib/runtime-config.ts prefers it over the baked value, so an
# empty build arg is repointable at RUNTIME without a rebuild (#700, #767).
# Adding them here would break the cloud build, which legitimately leaves
# VITE_API_URL to PUBLIC_URL.
#
# VITE_EDITION is not recoverable. Empty silently becomes "community"
# (frontend/src/lib/edition.ts `|| 'community'`), so a cloud image would ship
# with no billing, no admin and no credits — and look fine until a user
# looked for them. All three build paths already pass it (Railway staging and
# production service vars, and community-image.yml).
RUN set -eu; \
    case "${VITE_EDITION:-}" in \
      community|business|cloud) echo "[build] VITE_EDITION=${VITE_EDITION}" ;; \
      "") echo "ERROR: VITE_EDITION is empty. Vite inlines it, and an empty value silently becomes 'community' — a cloud/business image would ship without billing or admin. Pass --build-arg VITE_EDITION=community|business|cloud." >&2; exit 1 ;; \
      *) echo "ERROR: VITE_EDITION='${VITE_EDITION}' is not one of community|business|cloud." >&2; exit 1 ;; \
    esac

WORKDIR /app/frontend
# Skip the `prebuild` lifecycle hook (would re-run tsup for shared+client
# but src dirs aren't copied; prebuilt dists are already in place).
# Skip `tsc --noEmit` here too — npm's hoisting in this Docker layer
# can produce duplicate copies of peer-dep packages (e.g. @tiptap/core
# in both /app/node_modules and /app/frontend/node_modules), which tsc
# treats as distinct types. Vite's resolver dedupes correctly. Type
# errors are caught by CI's typecheck job, not the Docker build.
# 4GB heap: the editor bundle outgrew Node's default (~2GB on CI runners) —
# the vite build OOM'd ("Reached heap limit") on two PR runs in two days
# (#780, #790), each time passing on rerun. Flake class closed at the root.
RUN NODE_OPTIONS=--max-old-space-size=4096 npx vite build

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
COPY packages/picker-ui/package.json ./packages/picker-ui/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci --omit=dev

# Ensure backend/node_modules exists even if all backend deps got hoisted
# to the root (avoids COPY failures in the runner stage).
RUN mkdir -p /app/backend/node_modules

# Built workspace-package dists, mirroring the runner stage's own COPYs: npm
# dedupes the private plugin's `@nodaro/*` dependencies onto the workspace
# symlinks (node_modules/@nodaro/shared -> ../packages/shared, and the same
# for prompts), which in THIS stage otherwise hold only package.json — the
# plugin import-smoke below then fails on a missing dist even though the
# runner image resolves it fine (staging deploys 7eccf973 and d1f0406f failed
# exactly here, on shared and prompts respectively). Copying the dists makes
# the smoke exercise the same resolution path production uses.
#
# Any workspace package a cloud plugin depends on needs its line here.
COPY --from=shared-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-build /app/packages/prompts/dist ./packages/prompts/dist

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
# PIN A MONTH-END BUILD, NEVER A MID-MONTH DAILY. BtbN keeps only ~2 weeks of
# `autobuild-<date>-<time>` dailies and then DELETES the whole release — tag,
# assets and all. The previous pin (2026-07-12, a daily) 404'd on 2026-07-27
# and took every image build and the characterize CI job down with it, since
# the tarball is fetched fresh whenever the Docker layer cache misses. The
# month-end snapshots (…-06-30-…, …-05-31-…) are retained for YEARS — the
# series currently reaches back to 2024-08 — so they are the only durable
# choice here. Verify a candidate still resolves before pinning it.
ARG FFMPEG_TARBALL_URL_AMD64=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-06-30-13-34/ffmpeg-n8.1.2-21-gce3c09c101-linux64-gpl-8.1.tar.xz
ARG FFMPEG_TARBALL_SHA256_AMD64=0ba73bbd93472c7622f6dec26d334c5e62e64d858d072490b2844320970456cd
ARG FFMPEG_TARBALL_URL_ARM64=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-06-30-13-34/ffmpeg-n8.1.2-21-gce3c09c101-linuxarm64-gpl-8.1.tar.xz
ARG FFMPEG_TARBALL_SHA256_ARM64=d3f90a71a38238466de2e4dc98537862d244e3307383435f94cbc4b8491033f8
# Caddy is PINNED — by version and SHA-512, per arch.
#
# It used to come from `caddyserver.com/api/download?os=linux&arch=…`, which is
# a ROLLING redirect to whatever is current: the image's reverse proxy — the
# thing every request in the community stack passes through — could change
# under us on any cache miss, and an older image could never be reproduced.
# That is the same shape as the ffmpeg scar below, which cost every image build
# when its pin moved.
#
# The SHA-512s are the values from Caddy's own `caddy_<ver>_checksums.txt`
# release asset (they publish 512, not 256), so a reviewer can verify a bump
# against upstream without trusting whoever made it:
#   curl -fsSL https://github.com/caddyserver/caddy/releases/download/v<ver>/caddy_<ver>_checksums.txt
ARG CADDY_VERSION=2.11.4
ARG CADDY_SHA512_AMD64=8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9
ARG CADDY_SHA512_ARM64=d5a7c423853c24a799765e0e8210d5c7c22a8f56ed37a3cae2fb9f58be138853c02b4efd6b59d576e6d8c7c0d30b9c1592deeaa6a536ff69bcca23b8c1ea709c
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
    && case "$(dpkg --print-architecture)" in \
         amd64) CADDY_ARCH=amd64; CADDY_SHA512="${CADDY_SHA512_AMD64}" ;; \
         arm64) CADDY_ARCH=arm64; CADDY_SHA512="${CADDY_SHA512_ARM64}" ;; \
         *) echo "unsupported arch for caddy: $(dpkg --print-architecture)" >&2; exit 1 ;; \
       esac \
    && curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${CADDY_ARCH}.tar.gz" -o /tmp/caddy.tar.gz \
    && echo "${CADDY_SHA512}  /tmp/caddy.tar.gz" | sha512sum -c - \
    && tar -xzf /tmp/caddy.tar.gz -C /tmp caddy \
    && mv /tmp/caddy /usr/bin/caddy \
    && rm -f /tmp/caddy.tar.gz \
    && chmod +x /usr/bin/caddy \
    && caddy version

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
# Release version for /health, /v1/setup/status and the update check —
# same value the frontend baked as VITE_APP_VERSION.
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

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

# 5c. Self-host migration runner + SQL files (whitelisted in .dockerignore).
#     Applied on boot ONLY when RUN_MIGRATIONS_ON_BOOT=true + DATABASE_URL are
#     set (the community compose does; Railway/cloud never does — cloud
#     migrations stay PR-event-driven through the Supabase integration).
COPY --chown=node:node backend/scripts/run-migrations.mjs ./backend/scripts/run-migrations.mjs
COPY --chown=node:node supabase/migrations ./supabase/migrations

# 6. Remotion package source — bundled at runtime by @remotion/bundler.
COPY --chown=node:node --from=frontend-build /app/packages/remotion/src ./packages/remotion/src
COPY --chown=node:node --from=frontend-build /app/packages/remotion/tsconfig.json ./packages/remotion/tsconfig.json

# 7. Frontend Vite static build + Caddy config.
COPY --chown=node:node --from=frontend-build /app/frontend/dist ./frontend/dist
COPY frontend/Caddyfile /etc/caddy/Caddyfile

# 7b. Frontend runtime-config writer (B1) — start.sh runs it at boot to emit
#     /config.js (apiUrl / supabase / locale + the deployment surface profile).
#     A testable module rather than an inline heredoc; see start.sh below.
COPY --chown=node:node tools/build-runtime-config.mjs ./tools/build-runtime-config.mjs

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

# --- Instance encryption key (self-host ONLY) --------------------------------
# NODARO_ENCRYPTION_KEY encrypts every secret the server stores for itself
# (social OAuth tokens, provider keys pasted on /setup). Unlike the
# orchestrator secret above, a value that CHANGES across restarts turns all
# of that into noise — so when it is not provided we generate it ONCE and
# persist it to the app-data volume, then reuse it on every later boot.
# Gate: RUN_MIGRATIONS_ON_BOOT=true is set only by the community compose
# stack. Managed deployments (Cloud/business on Railway) have no persistent
# disk between deploys and MUST set the variable explicitly — there we
# deliberately do nothing, so a misconfiguration surfaces as the named
# EncryptionKeyMissingError instead of a silently rotating key.
if [ "$RUN_MIGRATIONS_ON_BOOT" = "true" ] && [ -z "$NODARO_ENCRYPTION_KEY" ] && [ -z "$SOCIAL_ENCRYPTION_KEY" ]; then
  KEY_DIR="${NODARO_DATA_DIR:-/data/nodaro}"
  KEY_FILE="$KEY_DIR/encryption-key"
  if [ -s "$KEY_FILE" ]; then
    export NODARO_ENCRYPTION_KEY=$(cat "$KEY_FILE")
    export NODARO_ENCRYPTION_KEY_SOURCE=generated
    echo "[start.sh] instance encryption key loaded from $KEY_FILE"
  else
    mkdir -p "$KEY_DIR" 2>/dev/null || true
    if [ -d "$KEY_DIR" ] && [ -w "$KEY_DIR" ]; then
      GENERATED=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
      umask 077
      printf '%s' "$GENERATED" > "$KEY_FILE"
      export NODARO_ENCRYPTION_KEY="$GENERATED"
      export NODARO_ENCRYPTION_KEY_SOURCE=generated
      echo "[start.sh] generated the instance encryption key and saved it to $KEY_FILE — BACK THIS FILE UP with the database (it is in the app-data volume); losing it makes stored keys unreadable"
    else
      echo "[start.sh] WARNING: no NODARO_ENCRYPTION_KEY and $KEY_DIR is not writable — stored provider keys and social connections are disabled until the key is set"
    fi
  fi
fi

# --- Signal topology (incident 2026-07-15) -----------------------------------
# This script stays PID 1. Docker/Railway deliver SIGTERM to PID 1 ONLY; the
# previous `exec caddy` made Caddy PID 1, so on every deploy Caddy shut down
# gracefully while the node siblings (server + BullMQ workers) were SIGKILLed
# without ever seeing SIGTERM — worker.ts's drain never ran, active jobs died
# holding their BullMQ locks, and users watched `processing` rows freeze for
# lockDuration + stalled-check before recovery. On TERM/INT we forward the
# signal to every child and wait for them to drain before exiting.
TERMINATING=""
CHILD_PIDS=""

forward_term() {
  TERMINATING=1
  echo "[start.sh] TERM/INT received — forwarding to children:$CHILD_PIDS"
  kill -TERM $CHILD_PIDS 2>/dev/null
}
trap forward_term TERM INT

# Self-host: apply supabase/migrations before anything touches the DB.
# Gated on BOTH vars so cloud (neither set) and partial configs are no-ops.
# A failed migration refuses to boot — an API against a half-migrated
# schema fails stranger and later.
if [ "$RUN_MIGRATIONS_ON_BOOT" = "true" ] && [ -n "$DATABASE_URL" ]; then
  echo "[start.sh] applying database migrations..."
  if ! node /app/backend/scripts/run-migrations.mjs; then
    echo "[start.sh] migrations FAILED - refusing to start"
    exit 1
  fi
fi

# Start backend API server on fixed internal port
cd /app/backend
export BACKEND_PORT=9000
PORT=$BACKEND_PORT node dist/server.js &
CHILD_PIDS="$CHILD_PIDS $!"

# Supervised process runner: the queue consumers below are background
# siblings of this PID-1 script — without supervision, a crashed worker
# (e.g. OOM-killed during a render burst) stays dead while /health keeps
# serving 200 from server.js (incident 2026-06-11: orchestrator + worker
# died at ~21:08/21:12 UTC, queues froze for 10h, container stayed green).
# 10s backoff prevents a hot crash-loop; the loop dies with the container.
# On TERM/INT the subshell forwards to its current node child, waits for the
# child's drain, and exits WITHOUT restarting — a fresh worker in a dying
# container would pick up jobs only to be SIGKILLed holding their locks.
supervise() {
  name="$1"; shift
  sup_child=""
  trap '[ -n "$sup_child" ] && kill -TERM "$sup_child" 2>/dev/null; [ -n "$sup_child" ] && wait "$sup_child"; echo "[supervise] $name stopped (drained)"; exit 0' TERM INT
  while :; do
    "$@" &
    sup_child=$!
    wait "$sup_child"
    code=$?
    echo "[supervise] $name exited (code $code) — restarting in 10s"
    sleep 10
  done
}

# Start BullMQ worker (job processor)
supervise worker node dist/worker.js &
CHILD_PIDS="$CHILD_PIDS $!"

# Start BullMQ render worker (Remotion video rendering)
supervise render-worker node dist/render-worker.js &
CHILD_PIDS="$CHILD_PIDS $!"

# Start BullMQ orchestrator worker (workflow execution)
supervise orchestrator node dist/orchestrator.js &
CHILD_PIDS="$CHILD_PIDS $!"

# Start BullMQ pipeline worker (Story-to-Video orchestration).
# Cloud-only — exits cleanly on non-cloud editions so the same image runs
# for self-hosted Community/Business builds; the supervisor would restart
# that clean exit too, so gate it: only supervise when EDITION=cloud.
if [ "$EDITION" = "cloud" ]; then
  supervise pipeline-worker node dist/pipeline-worker.js &
else
  node dist/pipeline-worker.js &
fi
CHILD_PIDS="$CHILD_PIDS $!"

# Wait for backend to be ready before accepting traffic
echo "Waiting for backend on port 9000..."
for i in $(seq 1 30); do
  if [ -n "$TERMINATING" ]; then break; fi
  if curl -sf http://127.0.0.1:9000/health > /dev/null 2>&1; then
    echo "Backend is ready"
    break
  fi
  sleep 1
done

# Frontend runtime config — /config.js, read by the browser before the app
# boots (frontend/index.html → src/lib/runtime-config.ts). One published
# image then serves any PUBLIC_URL / port / anon key without a rebuild
# (release check 13, #700). Only values that are actually set are emitted; an
# absent key falls back to the value inlined at build time, which is what
# keeps the cloud (where both agree) byte-identical.
#   apiUrl          <- PUBLIC_URL
#   supabaseUrl     <- FRONTEND_SUPABASE_URL if set; else, when the backend's
#                      SUPABASE_URL is this container's own Caddy proxy (the
#                      bundled community stack), PUBLIC_URL/supabase; else
#                      nothing (a managed project URL is baked correctly).
#   supabaseAnonKey <- SUPABASE_ANON_KEY
#   defaultLocale   <- DEFAULT_LOCALE (the locale a fresh visitor to this install
#                      starts in; unset/blank/unrecognised → browser detection)
# ALWAYS written — a missing file would fall through try_files to index.html
# served as JavaScript.
FRONTEND_SUPABASE_URL_EFFECTIVE="$FRONTEND_SUPABASE_URL"
if [ -z "$FRONTEND_SUPABASE_URL_EFFECTIVE" ] && [ -n "$PUBLIC_URL" ]; then
  case "$SUPABASE_URL" in
    http://localhost:3000/supabase*|http://127.0.0.1:3000/supabase*) FRONTEND_SUPABASE_URL_EFFECTIVE="${PUBLIC_URL%/}/supabase" ;;
  esac
fi
# The surface block (B1) rides the same channel — parsed by
# tools/build-runtime-config.mjs (a testable module, not an inline heredoc:
# inline-JSON-or-@file parsing + the d2 business+ edition gate are too much
# logic to leave untested). It prints the /config.js line to stdout (log line to
# stderr), so the redirect captures only the payload; on failure the file is
# left empty, which the frontend reads as "no override" → build-time values.
if ! RUNTIME_API_URL="$PUBLIC_URL" RUNTIME_SUPABASE_URL="$FRONTEND_SUPABASE_URL_EFFECTIVE" RUNTIME_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" RUNTIME_FREECUT_URL="$FREECUT_URL" RUNTIME_DEFAULT_LOCALE="$DEFAULT_LOCALE" RUNTIME_SURFACE_PROFILE="$NODARO_SURFACE_PROFILE" EDITION="$EDITION" \
  node /app/tools/build-runtime-config.mjs > /app/frontend/dist/config.js; then
  echo "[start.sh] WARNING: could not write /app/frontend/dist/config.js — the frontend keeps its build-time URLs"
fi

# Start Caddy (reverse proxy). Backgrounded — start.sh remains PID 1 so it
# owns signal forwarding; Caddy still receives a clean TERM through the trap.
if [ -z "$TERMINATING" ]; then
  cd /app
  caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
  CHILD_PIDS="$CHILD_PIDS $!"
fi

# Reap children. On TERM the trap forwards the signal, the interrupted first
# `wait` returns, and the second `wait` blocks until every child has actually
# drained (Railway's SIGKILL at grace-end is the backstop for hung drains).
wait
wait
exit 0
EOF

RUN chmod +x /app/start.sh

# Self-host app data (the generated instance encryption key lives here; the
# community compose mounts a named volume on it). Created and owned by the
# runtime user so a fresh volume inherits writable ownership.
RUN mkdir -p /data/nodaro && chown node:node /data/nodaro

USER node

CMD ["/app/start.sh"]
