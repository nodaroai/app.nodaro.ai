#!/bin/sh
# Installs the shared site header (@nodaroai/shell, a private Nodaro package,
# which also carries the media editor behind `virtual:media-editor`) into the
# workspace — on a CLOUD build only. With VITE_SHARED_HEADER=true it is
# required (no NPM_TOKEN is an error); with the flag off it is installed for
# the trend admin's media editor when NPM_TOKEN is set, and skipped when it is
# not (the admin then keeps its own editor; the header stays off either way).
# Every other build (community, business, public CI) exits here untouched, so
# its node_modules and bundle are as before.
#
# Used by the Dockerfile's frontend stage and by the internal-only contract
# job (.github/workflows/shared-header-contract.yml).
#
#   usage: sh frontend/src/ee/shell/install-package.sh [<workspace root>]   (default /app)
#   env:   VITE_EDITION                       the gate (cloud only)
#          VITE_SHARED_HEADER                 true: the package is required
#          NPM_TOKEN                          a read:packages token for the org's private packages
#          SHARED_HEADER_PKG_VERSION          optional; the pin below otherwise
#
# The token is read with printenv inside this script, written to a temporary
# .npmrc and removed on exit (success or failure). It never appears on a
# command line, so a builder that logs RUN lines with build args substituted
# cannot print it.
set -eu

PIN="0.8.0"
VERSION="${SHARED_HEADER_PKG_VERSION:-$PIN}"

if [ "${VITE_EDITION:-}" != "cloud" ]; then
  echo "[site-header] skipped (edition=${VITE_EDITION:-unset})"
  exit 0
fi
if [ "${VITE_SHARED_HEADER:-}" != "true" ] && [ -z "$(printenv NPM_TOKEN || true)" ]; then
  echo "[site-header] skipped (VITE_SHARED_HEADER=${VITE_SHARED_HEADER:-unset}, no NPM_TOKEN): the admin keeps its own media editor"
  exit 0
fi

# An exact version only: a dist-tag (latest, next) or a range would install
# whatever is newest at build time. `case` sees the whole value (a line-based
# grep would pass "1.2.3<newline>latest"): only [0-9A-Za-z.-], and the part
# before any "-prerelease" is exactly three dot-separated numbers.
not_a_version() {
  echo "[site-header] refusing: SHARED_HEADER_PKG_VERSION must be an exact version (x.y.z[-pre])" >&2
  exit 1
}
case "$VERSION" in
  "" | *[!0-9A-Za-z.-]*) not_a_version ;;
esac
CORE="${VERSION%%-*}"
case "$CORE" in
  *[!0-9.]* | .* | *. | *..* | *.*.*.*) not_a_version ;;
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) not_a_version ;;
esac

if [ -z "$(printenv NPM_TOKEN || true)" ]; then
  echo "[site-header] VITE_SHARED_HEADER=true on a cloud build needs NPM_TOKEN (unset)" >&2
  exit 1
fi

# Absolute, so the cleanup below removes the right file whatever the argument.
ROOT="$(cd "${1:-/app}" && pwd)"
cd "$ROOT"
if [ -e .npmrc ]; then
  echo "[site-header] refusing: $ROOT/.npmrc already exists" >&2
  exit 1
fi
trap 'rm -f "$ROOT/.npmrc"' EXIT
trap 'rm -f "$ROOT/.npmrc"; exit 1' INT TERM HUP
# Readable by the build user only (a subshell, so the install keeps its umask).
(
  umask 077
  printf '%s\n' "@nodaroai:registry=https://npm.pkg.github.com" "//npm.pkg.github.com/:_authToken=$(printenv NPM_TOKEN)" > .npmrc
)

npm install --no-save --ignore-scripts --no-audit --no-fund "@nodaroai/shell@${VERSION}"

# The header's peers (@nodaro/sdk, @nodaro/shared, react, react-dom,
# react-query) must resolve to the workspace's own copies: the workspace links
# still in place, and no copy nested under the private scope. Either would mean
# a peer range drifted and the header would run against a second SDK or React.
if ! { [ -L node_modules/@nodaro/sdk ] && [ -L node_modules/@nodaro/shared ]; }; then
  echo "[site-header] the workspace links node_modules/@nodaro/sdk and @nodaro/shared are gone after the install" >&2
  exit 1
fi
if [ -n "$(find node_modules/@nodaroai \( -path '*/node_modules/@nodaro/*' -o -path '*/node_modules/react' -o -path '*/node_modules/react-dom' -o -path '*/node_modules/@tanstack/react-query' \) -type d 2>/dev/null || true)" ]; then
  echo "[site-header] a nested @nodaro, react, react-dom or react-query copy was installed under node_modules/@nodaroai — the peer ranges disagree with the workspace" >&2
  exit 1
fi

echo "[site-header] installed ${VERSION}"
