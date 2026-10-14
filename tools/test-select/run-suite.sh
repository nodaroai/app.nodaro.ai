#!/usr/bin/env bash
# tools/test-select/run-suite.sh
# Runs one project's vitest suite the way the Select step decided. Shared by
# Frontend Tests and Backend Tests; run from the project directory.
# Env: SELECTION (affected|none|full|shadow|post-merge; anything else, empty
# or unset runs the full suite), LIST (selected files, project-relative — in
# shadow mode the files the selector WOULD have run), REPORT (vitest JSON
# report path; in shadow and post-merge its output is logged to
# "$REPORT.log"), FAILED
# (out: the test files that are really failing — after a post-merge failure,
# the files that failed again when re-run alone; read by the dev failure
# attribution job), "$FAILED.flaky" (out: post-merge files that failed in the
# full run but passed alone — labelled likely flaky, never forgiven),
# "$FAILED.unknown" (out: post-merge files whose re-run crashed without a
# report — their re-run result is unknown).
# Shadow mode only: SHADOW_SELECTION (what the selector would have run:
# affected|none|full; unset → full), SHADOW_OUT (the miss check's JSON),
# PROJECT (frontend|backend, for its annotations).
# Coverage is not measured here: nightly-coverage.yml does.
set -uo pipefail
# Under `set -u` an unset variable aborts the script with exit 1 — a green
# suite must never end that way, so every output path has a default.
REPORT="${REPORT:-$(mktemp)}"
FAILED="${FAILED:-$(mktemp)}"
: > "$FAILED"
: > "$FAILED.flaky"
: > "$FAILED.unknown"
case "${SELECTION:-}" in
  none) echo "No test in this project can be affected by this change."; exit 0 ;;
  affected) mapfile -t files < "$LIST"; npx vitest run "${files[@]}"; exit $? ;;
  full) npx vitest run; exit $? ;;
  shadow)
    # PRs into dev until TEST_SELECT_ENFORCE=true (decided 2026-10-13): the
    # FULL suite decides pass/fail; the selection is only compared with what
    # failed, so a selector miss shows up before it can skip a real failure.
    # vitest's exit code goes to the check too: a failed run with no failing
    # file is recorded as unattributed (a possible miss), never as clean — and
    # so is an unhandled error, which the JSON report does not record.
    npx vitest run --reporter=default --reporter=json --outputFile.json="$REPORT" 2>&1 | tee "$REPORT.log"
    rc=${PIPESTATUS[0]}
    unhandled=0
    grep -qF -e 'Unhandled Error' -e 'Unhandled Rejection' "$REPORT.log" && unhandled=1
    node ../tools/test-select/shadow-check.mjs "$REPORT" "${LIST:-/dev/null}" "${SHADOW_SELECTION:-full}" \
      "${SHADOW_OUT:-$REPORT.shadow.json}" "${GITHUB_STEP_SUMMARY:-/dev/null}" "${PROJECT:-$(basename "$PWD")}" "$rc" "$unhandled" \
      || echo "::warning::the shadow check could not run — the full suite's result stands"
    exit "$rc" ;;
  post-merge) ;;
  # Fail safe: a mode this script does not know must never skip tests.
  *) echo "::warning::unknown selection '${SELECTION:-}' — running the full suite"; npx vitest run; exit $? ;;
esac

# post-merge: the full suite on every dev commit. A failure is never turned
# green by a re-run (decided 2026-10-13): `verified` lets main skip its tests
# because this exact tree passed here, so a green dev run must never rest on a
# masked failure. A failed file is re-run once, alone, only to LABEL it for the
# attribution comment — failed again ($FAILED) or passed alone, likely flaky
# ($FAILED.flaky) — and the run stays red either way.
npx vitest run --reporter=default --reporter=json --outputFile.json="$REPORT" 2>&1 | tee "$REPORT.log"
rc=${PIPESTATUS[0]}
[ "$rc" -eq 0 ] && exit 0
[ -s "$REPORT" ] || exit "$rc"
node ../tools/test-select/failed-files.mjs "$REPORT" > "$FAILED" || exit "$rc"
# The JSON report does not record Vitest's unhandled errors, so a file that
# passes alone would hide one: label nothing flaky. Vitest's banners are
# "Unhandled Errors" / "Unhandled Rejection" (grep -F is case-sensitive).
if grep -qF -e 'Unhandled Error' -e 'Unhandled Rejection' "$REPORT.log"; then
  echo "::error::Vitest reported an unhandled error — a real failure, not re-run"
  exit "$rc"
fi
mapfile -t failed < "$FAILED"
# No failed file (a crash) or too many to be flakes: real, not re-run.
if [ "${#failed[@]}" -eq 0 ] || [ "${#failed[@]}" -gt 25 ]; then exit "$rc"; fi
echo "::warning::Re-running ${#failed[@]} failed test file(s) once, alone, to label them — the run stays red either way"
rm -f "$REPORT.rerun" "$FAILED.rerun"
if npx vitest run "${failed[@]}" --reporter=default --reporter=json --outputFile.json="$REPORT.rerun"; then
  echo "::warning::Likely flaky — failed in the full run, passed alone: ${failed[*]} (the run stays red)"
  mv "$FAILED" "$FAILED.flaky"
  : > "$FAILED"
  exit "$rc"
fi
# Still failing: the files that failed again stay in $FAILED; the rest passed
# alone and are labelled flaky. Without a usable re-run report (vitest crashed
# before writing it, or it names no file) the re-run result is unknown: the
# files go to $FAILED.unknown — never called flaky, never "failed again".
if [ -s "$REPORT.rerun" ] && node ../tools/test-select/failed-files.mjs "$REPORT.rerun" > "$FAILED.rerun" && [ -s "$FAILED.rerun" ]; then
  grep -vxF -f "$FAILED.rerun" "$FAILED" > "$FAILED.flaky" || true
  mv "$FAILED.rerun" "$FAILED"
else
  mv "$FAILED" "$FAILED.unknown"
  : > "$FAILED"
fi
exit "$rc"
