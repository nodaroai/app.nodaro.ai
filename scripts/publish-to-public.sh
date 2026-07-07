#!/usr/bin/env bash
# Gated publish: mirror this private repo's main/dev → the PUBLIC app.nodaro.ai,
# ONLY if the leak gates pass and the branch descends from the clean floor.
# Run from a CLEAN clone of app.nodaro.ai-internal. This is the manual escape
# hatch + the exact logic the mirror-to-public.yml workflow automates.
#   usage: scripts/publish-to-public.sh <main|dev>
set -euo pipefail
BRANCH="${1:?usage: publish-to-public.sh <main|dev>}"
FLOOR="15fc0318f6e853b989409e0382909c76187d17a4"   # clean-generation genesis
PUBLIC="git@github.com:nodaroai/app.nodaro.ai.git"

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

echo "== fast-forward publish  private/$BRANCH -> public/$BRANCH =="
git push "$PUBLIC" "$BRANCH:$BRANCH"
echo "PUBLISHED $BRANCH -> public ✓"
