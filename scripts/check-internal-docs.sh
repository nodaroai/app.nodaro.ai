#!/usr/bin/env bash
# Internal-docs gate: abort when any TRACKED file sits under a directory that
# holds internal design specs and plans. Those live in the private planning
# repo; curated public design notes belong in docs/design/. Single source of
# the tree check, run by both:
#   - scripts/publish-to-public.sh   publish time (nightly mirror + manual path)
#   - ci.yml "No Internal Specs In Repo"   every PR and push
# The history half (a commit that added such a file, even one deleted later) is
# tools/check-history-surface.mjs, whose INTERNAL_DOC_DIRS must equal the list
# below (tools/__tests__/check-history-surface.test.mjs holds them equal).
#   usage: scripts/check-internal-docs.sh   (from anywhere in the checkout)
# Exit: 0 clean, 1 on a tracked file under one of the directories.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# A pathspec with a glob matches whole paths, so the bracket-class entry ends in
# `*` (which crosses `/` in a pathspec). The class keeps the literal directory
# name out of this file, which the public-surface gate would flag.
INTERNAL_DOC_DIRS=(specs/ "docs/[s]uperpowers/*")

echo "== internal-docs gate (${INTERNAL_DOC_DIRS[*]} are never tracked here) =="
offenders="$(git ls-files -- "${INTERNAL_DOC_DIRS[@]}")"
if [ -n "$offenders" ]; then
  echo "ABORT: internal planning docs are tracked. Move them to the private planning repo; curated public design notes belong in docs/design/."
  echo "$offenders" | head -20
  exit 1
fi
echo "clean"
