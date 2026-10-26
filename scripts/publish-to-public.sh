#!/usr/bin/env bash
# Gated publish: mirror this private repo's main/dev → the PUBLIC app.nodaro.ai,
# ONLY if the leak gates pass and the branch descends from the clean floor.
# Single source of the publish-gate logic — used by BOTH the manual path (run
# from a clean clone) and the nightly mirror-to-public.yml workflow.
#   usage: scripts/publish-to-public.sh <main|dev>
# env:
#   PUBLIC_REMOTE     push target (default: SSH). CI passes an HTTPS URL; its
#                     credential is the nodaro-mirror App's token, the only
#                     identity public main/dev accept updates from (ruleset).
#   MIRROR_DRY_RUN=1  run the gate + show the delta, but DO NOT push (gate-only).
# exit codes: 0 published (or nothing to do), 3 public/$BRANCH has diverged
#   (carries a commit internal lacks, so it cannot fast-forward), anything else
#   a gate or push failure.
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
# The private-marker gate is its own script, shared with the PR-time check
# (private-marker-check.yml). Read it NOW, from the tree this script was started
# from: the checkout below swaps in $BRANCH's tree, which can predate the gate's
# own file, and a gate missing there would abort the publish for the wrong
# reason. Same source as when the gate was written inline here.
MARKER_GATE_SRC="$(cat "$(dirname "${BASH_SOURCE[0]}")/check-private-markers.sh")"
# Same reason, same treatment: the internal-docs tree gate, shared with
# ci.yml's "No Internal Specs In Repo".
INTERNAL_DOCS_GATE_SRC="$(cat "$(dirname "${BASH_SOURCE[0]}")/check-internal-docs.sh")"

git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"

echo "== leak gates (each excludes tools/ so it never self-trips) =="
node tools/check-private-leaks.mjs
node tools/check-pricing-leaks.mjs
node tools/check-ee-imports.mjs
node tools/check-billing-dumps.mjs
node tools/check-public-surface.mjs
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

bash -c "$MARKER_GATE_SRC" check-private-markers.sh   # scripts/check-private-markers.sh
bash -c "$INTERNAL_DOCS_GATE_SRC" check-internal-docs.sh   # scripts/check-internal-docs.sh

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

echo "== history gate (never-public content added by the commits about to be published) =="
# The other leak gates read the tracked TREE. This push carries HISTORY: a line
# one commit added and a later commit scrubbed is world-readable forever through
# `git log -p` on the public remote, with every tree gate green — and public
# history can never be re-scrubbed. So every unpublished commit is read whole:
# the lines it adds (a merge: what its conflict resolution wrote), the paths it
# writes, and its message, against the surface categories, the internal-docs
# directories, the private marker and symbol lists, and gitleaks (whose
# `detect` above reads diffs, never messages). The lists are hard-required by
# the same variables as their tree gates; gitleaks is required here.
# A finding on an already-merged commit cannot be rebased away: pin it in
# .github/mirror-history-pins.txt on a reviewed PR to publish it anyway.
# Scope is exactly the commits that have NOT been published yet (public/$BRANCH
# stays an ancestor, so the push still fast-forwards). Anything older is
# already out, and re-flagging it would deadlock the mirror.
# "Already published" is the union of BOTH public heads, not just this branch's:
# after a dev->main promotion, main..public/main is full of commits the world
# already read on public/dev, and re-flagging those would abort the mirror over
# history no one can rewrite any more.
NOT_PUBLISHED=""
for PB in main dev; do
  PSHA=$(git ls-remote "$PUBLIC_REMOTE" "refs/heads/$PB" 2>/dev/null | awk '{print $1}')
  [ -n "${PSHA:-}" ] || continue
  git fetch -q "$PUBLIC_REMOTE" "$PB" 2>/dev/null || true
  git cat-file -e "${PSHA}^{commit}" 2>/dev/null && NOT_PUBLISHED="$NOT_PUBLISHED $PSHA"
done
if [ -n "$NOT_PUBLISHED" ]; then
  # shellcheck disable=SC2086  # SHAs, deliberately word-split into rev-list args
  HISTORY_REQUIRE_GITLEAKS=1 node tools/check-history-surface.mjs "$BRANCH" --not $NOT_PUBLISHED
else
  echo "(no public head readable — history gate skipped; the tree gates still ran)"
fi

echo "== fast-forward check (public/$BRANCH must be an ancestor of internal/$BRANCH) =="
# Something landed on public/$BRANCH that internal lacks (2026-10-25: a public
# "Version Packages" PR was merged). The push cannot fast-forward, and pushing
# anyway would rewrite public history, so stop with the distinct code 3: the
# workflow reports the outage without failing the run, and the cure is to adopt
# that commit into internal (merge public/$BRANCH into dev on a PR).
if [ -n "${PUB:-}" ] && git cat-file -e "${PUB}^{commit}" 2>/dev/null \
  && ! git merge-base --is-ancestor "$PUB" "$BRANCH"; then
  echo "DIVERGED: public/$BRANCH ($PUB) is not an ancestor of internal/$BRANCH. Commits only on public:"
  git log --oneline "$BRANCH..$PUB" | head -20 || true
  exit 3
fi

if [ "${MIRROR_DRY_RUN:-0}" = "1" ]; then
  echo "== DRY RUN: gate passed for $BRANCH; NOT pushing (dry-run / no token) =="
  exit 0
fi

echo "== fast-forward publish  internal/$BRANCH -> public/$BRANCH =="
git push "$PUBLIC_REMOTE" "$BRANCH:$BRANCH"
echo "PUBLISHED $BRANCH -> public ✓"
