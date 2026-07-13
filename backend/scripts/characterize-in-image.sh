#!/usr/bin/env bash
# Run the ffmpeg output-characterization suite inside the PRODUCTION runtime
# environment: node:22-slim (Debian bookworm) + the exact apt-pinned ffmpeg
# from the Dockerfile, on linux/amd64 (production's architecture).
#
# WHY THIS EXISTS: your local ffmpeg is not production's ffmpeg. Homebrew
# ships 8.x, Debian bookworm ships 5.1.x, and their rendered output DIFFERS
# (afir's intrinsic gain alone is ×2 vs ×1 — a 6 dB change). Golden values
# blessed against the wrong binary are worse than none. The suite's own
# version guard rejects mismatched binaries; this script is how you satisfy
# it from a dev machine.
#
# Usage, from the repo root or anywhere:
#   backend/scripts/characterize-in-image.sh check    # compare against committed golden
#   backend/scripts/characterize-in-image.sh bless    # (re)write the golden for this binary
#
# `characterize:report` needs no container (it diffs two committed JSON
# files) — run it directly: cd backend && npm run characterize:report -- ...
#
# The named docker volume keeps the workspace between runs; npm ci still
# reinstalls (deliberately — deterministic, matches CI), so expect a few
# minutes per run. Requires Docker with linux/amd64 support (Rosetta/QEMU on
# arm64 hosts).
set -euo pipefail

MODE="${1:-check}"
case "$MODE" in
  check|bless) ;;
  *) echo "usage: $0 [check|bless]" >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Single source of truth for the pin is the Dockerfile. Two supported shapes,
# newest first: a static-tarball pin (URL + SHA256 ARGs — the container here
# is linux/amd64, so the AMD64 pair applies), else the legacy apt version pin.
# `|| true` keeps set -e from killing the script at an empty grep, so the
# friendly guard below gets to explain the problem.
FFMPEG_TARBALL_URL="$(grep -oE '^ARG FFMPEG_TARBALL_URL_AMD64=.*' "$REPO_ROOT/Dockerfile" | head -1 | cut -d= -f2- || true)"
FFMPEG_TARBALL_SHA256="$(grep -oE '^ARG FFMPEG_TARBALL_SHA256_AMD64=.*' "$REPO_ROOT/Dockerfile" | head -1 | cut -d= -f2- || true)"
FFMPEG_PIN="$(grep -oE 'FFMPEG_VERSION=[^ ]+' "$REPO_ROOT/Dockerfile" | head -1 | cut -d= -f2 || true)"
if [ -n "$FFMPEG_TARBALL_URL" ] && [ -n "$FFMPEG_TARBALL_SHA256" ]; then
  echo "[characterize-in-image] mode=$MODE ffmpeg=static tarball (from Dockerfile ARGs)"
  echo "[characterize-in-image]   $FFMPEG_TARBALL_URL"
elif [ -n "$FFMPEG_PIN" ]; then
  echo "[characterize-in-image] mode=$MODE ffmpeg=$FFMPEG_PIN (apt pin from Dockerfile)"
else
  echo "could not read an ffmpeg pin (FFMPEG_TARBALL_URL_AMD64/SHA256 or FFMPEG_VERSION) from $REPO_ROOT/Dockerfile" >&2
  exit 1
fi

GOLDEN_DIR="$REPO_ROOT/backend/src/providers/video/__characterization__/golden"
mkdir -p "$GOLDEN_DIR"

# -i is load-bearing: the payload arrives on stdin (bash -s <<EOF); without
# it the container's stdin is /dev/null and bash exits 0 having run nothing.
docker run --rm -i --platform linux/amd64 \
  -v "$REPO_ROOT":/src:ro \
  -v "$GOLDEN_DIR":/golden-out \
  -v nodaro-characterize-work:/work \
  -w /work \
  node:22-slim bash -s <<EOF
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "[container] installing pinned ffmpeg + fonts (matches Dockerfile runner stage)..."
apt-get update -qq >/dev/null
if [ -n "${FFMPEG_TARBALL_URL}" ]; then
  apt-get install -y -qq --no-install-recommends rsync curl ca-certificates xz-utils \
    fontconfig fonts-dejavu-core fonts-liberation >/dev/null
  curl -fsSL "${FFMPEG_TARBALL_URL}" -o /tmp/ffmpeg.tar.xz
  echo "${FFMPEG_TARBALL_SHA256}  /tmp/ffmpeg.tar.xz" | sha256sum -c - >/dev/null
  mkdir -p /tmp/ffmpeg-dist
  tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-dist --strip-components=1
  install -m 0755 /tmp/ffmpeg-dist/bin/ffmpeg /tmp/ffmpeg-dist/bin/ffprobe /usr/local/bin/
else
  apt-get install -y -qq --no-install-recommends rsync "ffmpeg=${FFMPEG_PIN}" \
    fontconfig fonts-dejavu-core fonts-liberation >/dev/null
fi
ffmpeg -version | head -1

echo "[container] syncing repo (node_modules/dist excluded)..."
mkdir -p /work/repo
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude dist --exclude .next \
  /src/ /work/repo/

cd /work/repo
# youtube-dl-exec's install scripts probe for python and try to download a
# yt-dlp binary; neither is wanted (or present) in this measurement container.
export YOUTUBE_DL_SKIP_DOWNLOAD=1
export YOUTUBE_DL_SKIP_PYTHON_CHECK=1
# The lockfile is written by npm 11; node:22-slim ships npm 10. Pin the same
# npm CI uses (ci.yml "Pin npm version" step) or npm ci rejects the lockfile.
corepack enable npm
corepack prepare npm@11.12.1 --activate
echo "[container] npm ci..."
npm ci --no-audit --no-fund >/dev/null
npm run build:packages

cd backend
npm run characterize:${MODE}

if [ "${MODE}" = "bless" ]; then
  cp -f src/providers/video/__characterization__/golden/*.json /golden-out/
  echo "[container] golden file(s) copied back to the host golden/ directory"
fi
EOF
