// tools/test-select/attribution.mjs
// The comment posted on the PR whose merge turned the post-merge full suite
// on dev red. Every dev commit gets its own full run, so the previous commit's
// result says whether this merge is the likely cause.
//
// A file that failed and then passed when re-run alone is only LABELLED
// likely flaky: the run stays red (decided 2026-10-13). `verified` lets main
// skip its tests on the strength of a green dev run, so that run must never
// rest on a masked failure.
export function buildAttributionComment({ sha, before, runUrl, failed, flaky = { frontend: [], backend: [] }, unknown = { frontend: [], backend: [] }, previousConclusion }) {
  const short = (s) => (s ?? "").slice(0, 7)
  const listOf = (byProject) => Object.entries(byProject ?? {})
    .flatMap(([project, files]) => (files ?? []).map((f) => `- ${project}: \`${f}\``))
  const real = listOf(failed)
  const flakes = listOf(flaky)
  const unknowns = listOf(unknown)
  // An unknown re-run result is not evidence of a flake.
  const allFlaky = real.length === 0 && unknowns.length === 0 && flakes.length > 0
  const verdict =
    allFlaky ? "Every failing file passed when re-run alone, so this looks flaky rather than caused by this merge — but a flaky test still keeps the run red."
    : previousConclusion === "success" ? `The previous dev commit \`${short(before)}\` passed the full suite, so this merge is the likely cause.`
    : previousConclusion === "failure" ? `The previous dev commit \`${short(before)}\` was already red — compare its failing files; this may be pre-existing.`
    : `The previous dev commit \`${short(before)}\` has no finished full run, so this cannot be attributed with certainty.`
  const sections = []
  if (real.length) {
    // The unhandled-error and too-many-files paths are never re-run, so the
    // heading must not claim every file was.
    sections.push("Failed again when re-run alone (or not re-run: an unhandled error, or more than 25 failed files):", ...real, "")
  }
  if (unknowns.length) {
    sections.push("Re-run alone gave no result (it crashed without a report) — status unknown:", ...unknowns, "")
  }
  if (flakes.length) {
    sections.push("Passed when re-run alone — likely flaky (dev stays red until it is fixed or the run is re-run):", ...flakes, "")
  }
  if (!sections.length) sections.push("Failing test files:", "- (not captured — see the run)", "")
  const unblock = allFlaky
    ? "`dev → main` stays blocked until the full suite on dev is green again: fix the flaky test, or re-run the run."
    : "`dev → main` stays blocked until the full suite on dev is green again: fix forward or revert this PR."
  return [
    `**The post-merge full test suite failed on \`dev\` at \`${short(sha)}\`** (this PR's merge). [Run](${runUrl})`,
    "",
    ...sections,
    verdict,
    "",
    unblock,
  ].join("\n")
}
