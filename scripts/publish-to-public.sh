#!/usr/bin/env bash
# Gated publish: mirror this private repo's main/dev → the PUBLIC app.nodaro.ai,
# ONLY if the leak gates pass and the branch descends from the clean floor.
# Single source of the publish-gate logic — used by BOTH the manual path (run
# from a clean clone) and the nightly mirror-to-public.yml workflow.
#   usage: scripts/publish-to-public.sh <main|dev>
# env:
#   PUBLIC_REMOTE     push target (default: SSH). CI passes an HTTPS+token URL.
#   MIRROR_DRY_RUN=1  run the gate + show the delta, but DO NOT push (gate-only).
set -euo pipefail
BRANCH="${1:?usage: publish-to-public.sh <main|dev>}"
FLOOR="15fc0318f6e853b989409e0382909c76187d17a4"   # clean-generation genesis
PUBLIC_REMOTE="${PUBLIC_REMOTE:-git@github.com:nodaroai/app.nodaro.ai.git}"

git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"

echo "== leak gates (each excludes tools/ so it never self-trips) =="
node tools/check-private-leaks.mjs
node tools/check-pricing-leaks.mjs
node tools/check-ee-imports.mjs
if command -v gitleaks >/dev/null; then
  gitleaks detect --no-banner --redact --source .
else
  echo "!! gitleaks not installed — the secret gate is MANDATORY before publishing. Install it and re-run."; exit 1
fi

echo "== ancestry guard (never publish pre-recreate / dirty history) =="
git merge-base --is-ancestor "$FLOOR" "$BRANCH" \
  || { echo "ABORT: $BRANCH does not descend from clean floor $FLOOR"; exit 1; }

echo "== pending delta (internal/$BRANCH not yet on public/$BRANCH) — review before it goes =="
if PUB=$(git ls-remote "$PUBLIC_REMOTE" "refs/heads/$BRANCH" 2>/dev/null | awk '{print $1}') && [ -n "${PUB:-}" ]; then
  git fetch -q "$PUBLIC_REMOTE" "$BRANCH" 2>/dev/null || true
  COUNT=$(git rev-list --count "${PUB}..${BRANCH}" 2>/dev/null || echo "?")
  echo "$COUNT commit(s) to publish:"
  git log --oneline "${PUB}..${BRANCH}" 2>/dev/null | head -50 || true
else
  echo "(could not read public/$BRANCH — first publish, or no read access without a token)"
fi

if [ "${MIRROR_DRY_RUN:-0}" = "1" ]; then
  echo "== DRY RUN: gate passed for $BRANCH; NOT pushing (dry-run / no token) =="
  exit 0
fi

echo "== fast-forward publish  internal/$BRANCH -> public/$BRANCH =="
git push "$PUBLIC_REMOTE" "$BRANCH:$BRANCH"
echo "PUBLISHED $BRANCH -> public ✓"
