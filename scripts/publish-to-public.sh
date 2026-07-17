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
# Identity-clean floor: commits reachable from this SHA are grandfathered by the
# author-identity gate (the pre-gate stray-identity commits of 2026-07-08..10 are
# sunk — already in history/public). Every commit created AFTER this floor must
# carry an allowlisted author+committer email or the publish aborts.
IDENTITY_FLOOR="c859397a4dfe24df3e5098c9853639a2b34bda2e"
AUTHOR_ALLOWLIST=".github/mirror-author-allowlist.txt"
PUBLIC_REMOTE="${PUBLIC_REMOTE:-git@github.com:nodaroai/app.nodaro.ai.git}"

git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"

echo "== leak gates (each excludes tools/ so it never self-trips) =="
node tools/check-private-leaks.mjs
node tools/check-pricing-leaks.mjs
node tools/check-ee-imports.mjs
if command -v gitleaks >/dev/null; then
  # Scoped to THIS branch's history, not the default --all refs. The gate's
  # contract is "nothing secret reaches public", and only $BRANCH is being
  # published — unscoped, any in-flight feature branch on origin can block
  # every publish (2026-07-17: false positives on a just-pushed branch stalled
  # the npm release), and local vs CI runs scan different ref sets. Pre-merge
  # coverage of feature branches lives in secret-scan.yml (PR-time half).
  gitleaks detect --no-banner --redact --source . --log-opts="--full-history $BRANCH"
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
  PUB=""
fi

echo "== author-identity gate (no private emails on newly-created commits) =="
# Check author AND committer of every commit newer than BOTH the public head
# and the identity floor against the allowlist (public noreply/bot addresses
# only — the list itself is world-readable, so it must never contain a private
# address; that's also why this is an allowlist, not a blocklist). Emails are
# compared case-insensitively. A miss aborts the publish: fix authorship with
# `git commit --amend --reset-author` BEFORE merging, or add a legitimately new
# public identity to the allowlist via PR.
BAD_IDENTITIES=$(git log --format='%h %ae%n%h %ce' "$BRANCH" --not ${PUB:+"$PUB"} "$IDENTITY_FLOOR" | sort -u | awk -v listfile="$AUTHOR_ALLOWLIST" '
  BEGIN {
    while ((getline line < listfile) > 0) {
      sub(/#.*/, "", line); gsub(/^[ \t]+|[ \t]+$/, "", line)
      if (line != "") allow[tolower(line)] = 1
    }
  }
  { if (!(tolower($2) in allow)) print }
')
if [ -n "$BAD_IDENTITIES" ]; then
  echo "ABORT: commit(s) carrying a non-allowlisted author/committer email would be published:"
  echo "$BAD_IDENTITIES"
  echo "Private emails must never reach the public mirror ($AUTHOR_ALLOWLIST documents the fix)."
  exit 1
fi
echo "author-identity gate ✓"

if [ "${MIRROR_DRY_RUN:-0}" = "1" ]; then
  echo "== DRY RUN: gate passed for $BRANCH; NOT pushing (dry-run / no token) =="
  exit 0
fi

echo "== fast-forward publish  internal/$BRANCH -> public/$BRANCH =="
git push "$PUBLIC_REMOTE" "$BRANCH:$BRANCH"
echo "PUBLISHED $BRANCH -> public ✓"
