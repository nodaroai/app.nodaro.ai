// tools/test-select/attribution.mjs
// The comment posted on the PRs whose merges turned the post-merge full suite
// on dev red. One run can cover several merges: the dev group of CI keeps one
// run going and only the newest pending one (ci.yml `concurrency`), so `before`
// is the last dev commit whose run FINISHED and `merges` lists every merge the
// run covers (tools/test-select/dev-batch.mjs). Its result says whether one of
// them is the likely cause.
//
// A file that failed and then passed when re-run alone is only LABELLED
// likely flaky: the run stays red (decided 2026-10-13). `verified` lets main
// skip its tests on the strength of a green dev run, so that run must never
// rest on a masked failure.
//
// `failedJobs`: the ids of the jobs this run waited on that FAILED
// (failedJobsFrom) — the two suites, whose files are listed below, and the
// jobs that test one corner of the tree (tools/ci/job-inputs.json: Remotion,
// Characterization, Migration Behavior, FFmpeg Ledger), which upload no file
// lists. A skipped job is not a failure.
const SUITE_JOBS = ["frontend-tests", "backend-tests"]
export function failedJobsFrom(needs) {
  return Object.entries(needs ?? {}).filter(([, n]) => n?.result === "failure").map(([id]) => id).sort()
}
export function buildAttributionComment({ sha, before, runUrl, failed, flaky = { frontend: [], backend: [] }, unknown = { frontend: [], backend: [] }, previousConclusion, failedJobs = [], merges = [] }) {
  const short = (s) => (s ?? "").slice(0, 7)
  const batch = merges.length > 1
  const cause = batch ? `one of these ${merges.length} merges is the likely cause` : "this merge is the likely cause"
  const covered = batch
    ? ["This run covered every merge since the last finished one:", ...merges.map((m) => `- \`${short(m.sha)}\`${m.pr ? ` #${m.pr}` : ""}`), ""]
    : []
  const listOf = (byProject) => Object.entries(byProject ?? {})
    .flatMap(([project, files]) => (files ?? []).map((f) => `- ${project}: \`${f}\``))
  const real = listOf(failed)
  const flakes = listOf(flaky)
  const unknowns = listOf(unknown)
  // A job outside the suites has no re-run, so its failure is never a flake.
  const otherJobs = failedJobs.filter((j) => !SUITE_JOBS.includes(j))
  // An unknown re-run result is not evidence of a flake.
  const allFlaky = real.length === 0 && unknowns.length === 0 && flakes.length > 0 && otherJobs.length === 0
  const verdict =
    allFlaky ? "Every failing file passed when re-run alone, so this looks flaky rather than caused by this merge — but a flaky test still keeps the run red."
    : previousConclusion === "success" ? `The previous dev commit \`${short(before)}\` passed the full suite, so ${cause}.`
    : previousConclusion === "failure" ? `The previous dev commit \`${short(before)}\` was already red — compare its failing files; this may be pre-existing.`
    : `The previous dev commit \`${short(before)}\` has no finished full run, so this cannot be attributed with certainty.`
  const sections = []
  if (otherJobs.length) sections.push("Failed jobs (see the run for their output):", ...otherJobs.map((j) => `- \`${j}\``), "")
  const fileSections = sections.length
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
  // No file list: say so, unless only the other jobs failed (a suite job
  // failing, or no job named at all, keeps the old "not captured" line).
  const suiteFailed = failedJobs.length === 0 || failedJobs.some((j) => SUITE_JOBS.includes(j))
  if (sections.length === fileSections && suiteFailed) sections.push("Failing test files:", "- (not captured — see the run)", "")
  const unblock = allFlaky
    ? "`dev → main` stays blocked until the full suite on dev is green again: fix the flaky test, or re-run the run."
    : `\`dev → main\` stays blocked until the full suite on dev is green again: fix forward or revert ${batch ? "the PR that broke it" : "this PR"}.`
  return [
    `**The post-merge run failed on \`dev\` at \`${short(sha)}\`** (${batch ? `${merges.length} merges, this PR's among them` : "this PR's merge"}). [Run](${runUrl})`,
    "",
    ...covered,
    ...sections,
    verdict,
    "",
    unblock,
  ].join("\n")
}
