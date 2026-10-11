#!/usr/bin/env bash
# Private-marker gate: abort when any TRACKED file contains a string from the
# private marker list. Single source of the gate, run by both:
#   - scripts/publish-to-public.sh   publish time (nightly mirror + manual path)
#   - private-marker-check.yml       every PR into dev and main
# so the check a PR passes is exactly the check its merge must pass to publish.
#   usage: scripts/check-private-markers.sh   (from anywhere in the checkout)
# env:
#   PRIVATE_LEAK_MARKERS      the list, newline-separated (a repo secret in CI)
#   MIRROR_REQUIRE_MARKERS=1  no list => ABORT instead of skipping with a note
# Without PRIVATE_LEAK_MARKERS, an untracked .leak-markers file at the checkout
# root is read instead (gitignored, so it can never be committed).
# Exit: 0 clean, or no list and not required; 1 on a hit or a required list missing.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== private-marker gate (strings that must never appear in a published tree) =="
# The marker list is PRIVATE (personal addresses, internal repo names,
# provenance terms) — it lives in the internal repo secret PRIVATE_LEAK_MARKERS
# (newline-separated, exported by mirror-to-public.yml) or a local untracked
# .leak-markers file, NEVER in this world-readable script. Markers are chosen
# to have zero legitimate use in the tree, so any hit aborts the publish.
# Marker VALUES are never echoed (this log may be shared); offending files are.
MARKERS="${PRIVATE_LEAK_MARKERS:-}"
if [ -z "$MARKERS" ] && [ -f .leak-markers ]; then MARKERS="$(cat .leak-markers)"; fi
if [ -n "$MARKERS" ]; then
  MARKER_HIT=0; MARKER_N=0
  while IFS= read -r m; do
    [ -z "$m" ] && continue
    MARKER_N=$((MARKER_N + 1))
    HITS=$(git grep -I -l -i -F -e "$m" -- . || true)
    if [ -n "$HITS" ]; then
      echo "ABORT: private marker #${MARKER_N} found in tracked files:"
      echo "$HITS" | head -10
      MARKER_HIT=1
    fi
  done <<< "$MARKERS"
  [ "$MARKER_HIT" = "1" ] && exit 1
  echo "clean (${MARKER_N} markers checked)"
elif [ "${MIRROR_REQUIRE_MARKERS:-}" = "1" ]; then
  echo "ABORT: MIRROR_REQUIRE_MARKERS=1 but no marker list — set the PRIVATE_LEAK_MARKERS repo secret."; exit 1
else
  echo "(no marker list — set PRIVATE_LEAK_MARKERS or .leak-markers; the nightly mirror requires it)"
fi
