#!/usr/bin/env bash
# Proves the repo's gitleaks config still catches a secret where an allowlist
# could hide one: plants a freshly generated, key-shaped fake token in files at
# the paths our allowlists and docs live on, scans them with .gitleaks.toml, and
# fails unless every planted file is flagged. A placeholder control
# (`Bearer YOUR_TOKEN`) must stay unflagged, so the allowlists still work.
#
# Why: a `paths` + `regexes` allowlist skips whole files in gitleaks 8.30.1. One
# such entry (`.*\.md$` + `Authorization:`) hid every secret in every markdown
# file from both the PR scan and the mirror gate, unnoticed (2026-10-26).
#
# Usage: tools/gitleaks-canary.sh   (from the repo root; needs gitleaks on PATH)
set -euo pipefail

CONFIG="$(pwd)/.gitleaks.toml"
[ -f "$CONFIG" ] || { echo "run from the repo root (no .gitleaks.toml here)" >&2; exit 2; }
command -v gitleaks >/dev/null || { echo "gitleaks is not installed" >&2; exit 2; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/src"

# Generated per run, so no key-shaped literal is ever committed: GitHub PAT shape.
fake_token() {
  printf 'ghp_%s' "$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 36)"
}

# Each must be flagged. Paths are relative to the scanned dir, as allowlist
# `paths` regexes see them.
MUST_FLAG=(
  "docs/api-integration.md|token = \"@SECRET@\""
  "CLAUDE.md|curl -H \"Authorization: Bearer @SECRET@\" https://api.example.test"
  "backend/src/routes/__tests__/pro-3d-render.test.ts|const t = \"@SECRET@\""
  "frontend/src/ee/app/billing-admin/__tests__/canary.test.tsx|const t = \"@SECRET@\""
  "backend/src/canary.ts|const t = \"@SECRET@\""
)
# Must NOT be flagged: a documented placeholder the allowlists exist for.
MUST_PASS="docs/placeholder.md|curl -H \"Authorization: Bearer YOUR_TOKEN\" https://api.example.test"

plant() {
  local rel="${1%%|*}" line="${1#*|}"
  mkdir -p "$WORK/src/$(dirname "$rel")"
  printf '%s\n' "${line//@SECRET@/$(fake_token)}" >"$WORK/src/$rel"
}

for entry in "${MUST_FLAG[@]}"; do plant "$entry"; done
plant "$MUST_PASS"

REPORT="$WORK/report.json"
# Exit 1 = leaks found, which is the expected outcome here.
( cd "$WORK/src" && gitleaks dir --no-banner --redact -c "$CONFIG" -f json -r "$REPORT" . ) >/dev/null 2>&1 || true
[ -s "$REPORT" ] || { echo "gitleaks wrote no report" >&2; exit 1; }

FLAGGED=$(node -e 'for (const f of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) console.log(f.File.replace(/^\.\//, ""))' "$REPORT" | sort -u)

fail=0
for entry in "${MUST_FLAG[@]}"; do
  rel="${entry%%|*}"
  if grep -qxF "$rel" <<<"$FLAGGED"; then
    echo "ok    flagged: $rel"
  else
    echo "MISS  not flagged: $rel (an allowlist hides a real-looking secret here)"
    fail=1
  fi
done
rel="${MUST_PASS%%|*}"
if grep -qxF "$rel" <<<"$FLAGGED"; then
  echo "MISS  placeholder flagged: $rel (the YOUR_ placeholder allowlist stopped working)"
  fail=1
else
  echo "ok    placeholder passes: $rel"
fi

[ "$fail" = 0 ] && echo "gitleaks canary: config catches every planted secret" || exit 1
