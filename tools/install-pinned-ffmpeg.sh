#!/usr/bin/env bash
# Install the production-pinned static ffmpeg build — THE single copy of the
# download / checksum-verify / extract / install procedure, shared by:
#
#   - the Dockerfile runner stage (passes its resolved ARG values directly),
#   - the characterize CI job (parses the Dockerfile ARGs, amd64),
#   - backend/scripts/characterize-in-image.sh (parses, arch-selectable),
#
# so a change to the tarball layout or install procedure can never silently
# diverge between the production image and the environments that bless and
# verify the characterization goldens (the "wrong binary blesses the wrong
# numbers" trap). The PIN VALUES live only in the Dockerfile ARGs; this
# script owns the one parser and the one installer.
#
# Usage:
#   install-pinned-ffmpeg.sh --url <tarball-url> --sha256 <hex>
#   install-pinned-ffmpeg.sh --from-dockerfile <path> --arch <amd64|arm64>
set -euo pipefail

URL=""
SHA=""
DOCKERFILE=""
ARCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --sha256) SHA="$2"; shift 2 ;;
    --from-dockerfile) DOCKERFILE="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    *) echo "install-pinned-ffmpeg: unknown argument $1" >&2; exit 1 ;;
  esac
done

if [ -n "$DOCKERFILE" ]; then
  case "$ARCH" in
    amd64|arm64) ;;
    *) echo "install-pinned-ffmpeg: --arch amd64|arm64 is required with --from-dockerfile" >&2; exit 1 ;;
  esac
  SUFFIX="$(printf '%s' "$ARCH" | tr '[:lower:]' '[:upper:]')"
  # `|| true` keeps set -e from killing us at an empty grep so the guard
  # below can explain the problem instead.
  URL="$(grep -oE "^ARG FFMPEG_TARBALL_URL_${SUFFIX}=.*" "$DOCKERFILE" | head -1 | cut -d= -f2- || true)"
  SHA="$(grep -oE "^ARG FFMPEG_TARBALL_SHA256_${SUFFIX}=.*" "$DOCKERFILE" | head -1 | cut -d= -f2- || true)"
fi

if [ -z "$URL" ] || [ -z "$SHA" ]; then
  echo "install-pinned-ffmpeg: could not resolve the ffmpeg tarball pin (need --url/--sha256, or FFMPEG_TARBALL_URL_*/SHA256_* ARGs in the Dockerfile) — refusing to install an unpinned ffmpeg" >&2
  exit 1
fi

echo "install-pinned-ffmpeg: $URL"
curl -fsSL "$URL" -o /tmp/ffmpeg.tar.xz
echo "$SHA  /tmp/ffmpeg.tar.xz" | sha256sum -c -
mkdir -p /tmp/ffmpeg-dist
tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-dist --strip-components=1
install -m 0755 /tmp/ffmpeg-dist/bin/ffmpeg /tmp/ffmpeg-dist/bin/ffprobe /usr/local/bin/
rm -rf /tmp/ffmpeg-dist /tmp/ffmpeg.tar.xz
ffmpeg -version | head -1
