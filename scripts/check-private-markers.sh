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
# One marker per line, matched exactly as written: spaces and tabs around a
# marker are part of it (" word " matches the word, not every word containing
# it). Only save artifacts are dropped: a byte-order mark at the start of the
# list and every carriage return at the end of a line (CRLF, or a file
# converted twice). An empty or whitespace-only line is no marker. A list with
# no marker at all (empty, or only blank lines) is no list: the secret falls
# back to .leak-markers, and with neither the gate skips — or aborts when the
# list is required.
# What can never be a list aborts, loudly and without a value: a .leak-markers
# that exists but is not a readable regular file; a list that is not UTF-8
# text (a NUL byte, or a UTF-16 byte-order mark: PowerShell's default save); a
# marker that an invisible character makes dead (a carriage return inside it,
# from lone-CR line ends, or a zero-width space, word joiner or byte-order mark
# at an edge, from a paste); and a git grep that fails rather than finds nothing.
# tools/private-marker-list.mjs (parseMarkerList, readMarkerList) reads and
# refuses the list by the same rules, so both gates number the markers alike;
# tools/__tests__/check-private-markers.test.mjs holds them equal. That gate
# reads edge whitespace as a word boundary instead (" word " also catches
# "word." and "word" at a line's edge), a superset of this exact match; this
# gate stays exact, so files already tracked cannot start failing the publish.
NOT_TEXT="ABORT: the private marker list is not UTF-8 text (it holds a NUL byte, or starts with a UTF-16 byte-order mark); save it as UTF-8."
UNREADABLE="ABORT: .leak-markers exists but cannot be read."
usable_markers() {
  local m
  while IFS= read -r m; do
    while [ "${m%$'\r'}" != "$m" ]; do m="${m%$'\r'}"; done
    [ -z "${m//[$' \t\r\v\f']/}" ] && continue
    printf '%s\n' "$m"
  done <<< "${1#$'\xEF\xBB\xBF'}"
}
# Byte patterns, matched in the C locale so no multibyte rule applies.
starts_utf16() ( LC_ALL=C; case "$1" in $'\xFF\xFE'* | $'\xFE\xFF'*) exit 0 ;; esac; exit 1 )
# U+200B zero-width space, U+2060 word joiner, U+FEFF byte-order mark.
dead_marker() (
  LC_ALL=C
  case "$1" in
    *$'\r'* | $'\xE2\x80\x8B'* | *$'\xE2\x80\x8B' | $'\xE2\x81\xA0'* | *$'\xE2\x81\xA0' | $'\xEF\xBB\xBF'* | *$'\xEF\xBB\xBF') exit 0 ;;
  esac
  exit 1
)
if starts_utf16 "${PRIVATE_LEAK_MARKERS:-}"; then echo "$NOT_TEXT"; exit 1; fi
MARKERS="$(usable_markers "${PRIVATE_LEAK_MARKERS:-}")"
if [ -z "$MARKERS" ] && [ -e .leak-markers ]; then
  # Only a readable regular file is a list: a directory or a FIFO is not.
  if [ ! -f .leak-markers ] || [ ! -r .leak-markers ]; then echo "$UNREADABLE"; exit 1; fi
  # $(cat) drops NUL bytes without a word, so count them first.
  NULS=$(LC_ALL=C tr -cd '\000' < .leak-markers | wc -c) || { echo "$UNREADABLE"; exit 1; }
  if [ $((NULS)) -gt 0 ]; then echo "$NOT_TEXT"; exit 1; fi
  LIST="$(cat .leak-markers)" || { echo "$UNREADABLE"; exit 1; }
  if starts_utf16 "$LIST"; then echo "$NOT_TEXT"; exit 1; fi
  MARKERS="$(usable_markers "$LIST")"
fi
if [ -n "$MARKERS" ]; then
  MARKER_DEAD=0; MARKER_N=0
  while IFS= read -r m; do
    MARKER_N=$((MARKER_N + 1))
    if dead_marker "$m"; then
      echo "ABORT: private marker #${MARKER_N} holds an invisible character (a carriage return inside it, or a zero-width character at an edge) and can never match; fix the list."
      MARKER_DEAD=1
    fi
  done <<< "$MARKERS"
  [ "$MARKER_DEAD" = "1" ] && exit 1
  MARKER_HIT=0; MARKER_N=0
  while IFS= read -r m; do
    MARKER_N=$((MARKER_N + 1))
    # git grep exits 1 for "no match" and 128 on an error. Its stderr is
    # dropped on purpose: an error message can quote the pattern, i.e. the
    # marker. The cost, in local runs only: a tracked file git cannot read is
    # skipped without a word (git still exits 0 or 1); a CI checkout has none.
    GREP_RC=0
    HITS=$(git grep -I -l -i -F -e "$m" -- . 2>/dev/null) || GREP_RC=$?
    if [ "$GREP_RC" -gt 1 ]; then
      echo "ABORT: private marker #${MARKER_N} could not be checked (git grep failed with exit ${GREP_RC})."
      MARKER_HIT=1
      continue
    fi
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
