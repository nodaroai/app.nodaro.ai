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
# It also installs the licence files the tarball carries (LICENSE, SOURCE, LINK-TRACE.txt
# and LICENSES/) under /usr/local/share/doc/ffmpeg-static.
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
# Where things go. The defaults are the image layout; the overrides exist so the
# test can run the real script against a fixture tarball without root.
BIN_DIR="${FFMPEG_BIN_DIR:-/usr/local/bin}"
DOC_DIR="${FFMPEG_DOC_DIR:-/usr/local/share/doc/ffmpeg-static}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL "$URL" -o "$WORK/ffmpeg.tar.xz"
echo "$SHA  $WORK/ffmpeg.tar.xz" | sha256sum -c -
mkdir -p "$WORK/dist"
tar -xf "$WORK/ffmpeg.tar.xz" -C "$WORK/dist" --strip-components=1
# The binary is GPL and statically links other libraries: its licence, the
# record of what it was built from and the licence text of every linked library
# travel with it into every image (prod and community). The pinned tarball always
# carries them; one that does not is refused rather than installed without them.
for f in LICENSE.txt SOURCE.txt LICENSES; do
  [ -e "$WORK/dist/$f" ] || { echo "install-pinned-ffmpeg: the tarball has no $f; refusing to install an ffmpeg without its licences" >&2; exit 1; }
done
[ -n "$(ls -A "$WORK/dist/LICENSES")" ] || { echo "install-pinned-ffmpeg: LICENSES/ is empty" >&2; exit 1; }
mkdir -p "$BIN_DIR" "$DOC_DIR"
install -m 0755 "$WORK/dist/bin/ffmpeg" "$WORK/dist/bin/ffprobe" "$BIN_DIR/"
install -m 0644 "$WORK/dist/LICENSE.txt" "$DOC_DIR/LICENSE"
install -m 0644 "$WORK/dist/SOURCE.txt" "$DOC_DIR/SOURCE"
[ ! -e "$WORK/dist/LINK-TRACE.txt" ] || install -m 0644 "$WORK/dist/LINK-TRACE.txt" "$DOC_DIR/LINK-TRACE.txt"
rm -rf "$DOC_DIR/LICENSES"
cp -R "$WORK/dist/LICENSES" "$DOC_DIR/LICENSES"
"$BIN_DIR/ffmpeg" -version | head -1
