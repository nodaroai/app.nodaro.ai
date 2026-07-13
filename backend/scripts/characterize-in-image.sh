#!/usr/bin/env bash
# Run the ffmpeg output-characterization suite inside the PRODUCTION runtime
# environment: node:22-slim (Debian bookworm) + the exact sha256-pinned static
# ffmpeg tarball from the Dockerfile ARGs, installed by the SAME script the
# production image uses (tools/install-pinned-ffmpeg.sh).
#
# WHY THIS EXISTS: your local ffmpeg is not production's ffmpeg. Homebrew
# ships its own build, Debian ships another, and their rendered output DIFFERS
# (afir's gain semantics alone changed between major versions). Golden values
# blessed against the wrong binary are worse than none. The suite's own
# version guard rejects mismatched binaries; this script is how you satisfy
# it from a dev machine.
#
# Usage, from the repo root or anywhere:
#   backend/scripts/characterize-in-image.sh check    # compare against committed golden
#   backend/scripts/characterize-in-image.sh bless    # (re)write the golden (deliberate!)
#
# Architecture: defaults to amd64 (what Railway/CI run). The production image
# also ships an arm64 build of the SAME ffmpeg source; verify cross-arch
# output parity against the amd64-blessed golden with:
#   CHARACTERIZE_ARCH=arm64 backend/scripts/characterize-in-image.sh check
# (the version guard passes — both arches report the same version string — so
# a green run IS the parity proof; failures localize exactly what diverges).
#
# `characterize:report` needs no container (it diffs two committed JSON
# files) — run it directly: cd backend && npm run characterize:report -- ...
#
# The named docker volume (per arch) keeps the workspace between runs; npm ci
# still reinstalls (deliberately — deterministic, matches CI), so expect a few
# minutes per run.
set -euo pipefail

MODE="${1:-check}"
case "$MODE" in
  check|bless) ;;
  *) echo "usage: $0 [check|bless]" >&2; exit 1 ;;
esac

ARCH="${CHARACTERIZE_ARCH:-amd64}"
case "$ARCH" in
  amd64|arm64) ;;
  *) echo "CHARACTERIZE_ARCH must be amd64 or arm64 (got: $ARCH)" >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

GOLDEN_DIR="$REPO_ROOT/backend/src/providers/video/__characterization__/golden"
mkdir -p "$GOLDEN_DIR"

# node_modules contain arch-specific native binaries (sharp, esbuild) — each
# arch gets its own workspace volume. amd64 keeps the historical name so the
# existing cache stays warm.
WORK_VOLUME="nodaro-characterize-work"
if [ "$ARCH" != "amd64" ]; then
  WORK_VOLUME="nodaro-characterize-work-$ARCH"
fi

echo "[characterize-in-image] mode=$MODE arch=$ARCH (pin parsed from the Dockerfile by tools/install-pinned-ffmpeg.sh)"

# -i is load-bearing: the payload arrives on stdin (bash -s <<EOF); without
# it the container's stdin is /dev/null and bash exits 0 having run nothing.
docker run --rm -i --platform "linux/$ARCH" \
  -v "$REPO_ROOT":/src:ro \
  -v "$GOLDEN_DIR":/golden-out \
  -v "$WORK_VOLUME":/work \
  -w /work \
  node:22-slim bash -s <<EOF
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "[container] installing pinned ffmpeg + fonts (matches Dockerfile runner stage)..."
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends rsync curl ca-certificates xz-utils \
  fontconfig fonts-dejavu-core fonts-liberation >/dev/null
bash /src/tools/install-pinned-ffmpeg.sh --from-dockerfile /src/Dockerfile --arch "$ARCH"

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
