// tools/test-select/ci-mode.mjs
// How CI tests this run (decided 2026-10-13):
//   PR into dev      → shadow: the full suite runs, and the selector's choice
//                      is reported and checked for misses (a failing test it
//                      would have skipped). Only a clean shadow record proves
//                      the selector complete, so enforcement is a repository
//                      variable flipped after one — TEST_SELECT_ENFORCE=true —
//                      not a code change. Enforced → affected: only the tests
//                      the change can affect.
//   push to dev      → post-merge: every test, after the merge, per commit
//                      (no coverage — that runs nightly, nightly-coverage.yml).
//   PR into main /
//   push to main     → verified when this exact tree already passed the full
//                      suite on dev (the dev→main merge changes nothing);
//                      otherwise full. The migrate job still waits on the
//                      test jobs, which conclude success quickly when verified.
//                      A release PR is usually opened or moved by the very
//                      dev push whose run it needs, seconds after that run
//                      starts, so a PR into main WAITS for the dev run on its
//                      head (bounded) instead of running the whole suite a
//                      second time beside it.
// Anything else, and any doubt, is full.
import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// `enforce` must be exactly true: anything else keeps PRs into dev in shadow
// mode, which never runs fewer tests.
export function decideMode({ event, ref, baseRef, tested, enforce }) {
  if (event === "push" && ref === "refs/heads/dev") return { mode: "post-merge", reason: "post-merge: the full suite runs on every dev commit" }
  if (event === "pull_request" && baseRef === "dev") {
    if (enforce === true) return { mode: "affected", reason: "PR into dev: only the tests this change can affect; the full suite runs after merge" }
    return { mode: "shadow", reason: "PR into dev, shadow mode: the full suite runs; the selector's choice is reported and checked for misses (enforcement: repository variable TEST_SELECT_ENFORCE=true)" }
  }
  const promotion = (event === "push" && ref === "refs/heads/main") || (event === "pull_request" && baseRef === "main")
  if (!promotion) return { mode: "full", reason: `${event} on ${ref}: no selection rule — running everything` }
  if (!tested) return { mode: "full", reason: "no dev commit to compare with — running everything" }
  if (!tested.treeMatches) return { mode: "full", reason: "this tree differs from the dev commit it comes from — running everything" }
  if (!tested.runGreen) {
    const why = {
      timeout: "the dev run on this commit did not finish in time",
      failed: "the dev run on this commit failed",
      dropped: "the dev run on this commit was dropped for a newer dev commit",
    }[tested.runState] ?? "the dev commit with this tree has no green full run"
    return { mode: "full", reason: `${why} — running everything` }
  }
  return { mode: "verified", reason: "this exact tree already passed the full suite on dev" }
}

// ci-mode runs on GitHub-hosted runners, which ship `gh`.
function realGh(...args) {
  return execFileSync("gh", ["api", ...args], { encoding: "utf8" }).trim()
}

/** How long a PR into main waits for the dev run on its head: past a dev run plus a busy pool's queue. */
export const RELEASE_WAIT_MS = 45 * 60 * 1000
const POLL_MS = 30 * 1000
const PENDING = new Set(["queued", "in_progress", "waiting", "pending", "requested"])
// One "status:conclusion" per run, comma-joined. A plain string: in a template
// literal `\(` would lose its backslash and break the jq interpolation.
const RUN_STATES_JQ = '[.workflow_runs[] | "\\(.status):\\(.conclusion // "")"] | join(",")'

/**
 * The state of the dev push runs of CI on one commit: "green", "pending",
 * "failed", "dropped" (cancelled — the dev group keeps only the newest
 * pending run) or "none" (not created yet, or never).
 */
export function devRunState(gh, repo, devSha) {
  const runs = gh(`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${devSha}&event=push&branch=dev&per_page=10`, "--jq", RUN_STATES_JQ)
    .split(",").filter(Boolean).map((r) => r.split(":"))
  if (runs.some(([, c]) => c === "success")) return "green"
  if (runs.some(([st]) => PENDING.has(st))) return "pending"
  if (runs.some(([, c]) => c === "cancelled") && !runs.some(([, c]) => c === "failure" || c === "timed_out")) return "dropped"
  return runs.length > 0 ? "failed" : "none"
}

// Which dev commit this run promotes, and whether that commit's exact tree
// already passed CI on dev. `gh`, `sleep` and `now` are injectable for tests.
export function gatherTested({ event, ref, baseRef, headSha, sha, repo }, gh = realGh, { sleep = sleepSync, now = Date.now, waitMs = RELEASE_WAIT_MS } = {}) {
  const tree = (s) => gh(`repos/${repo}/git/commits/${s}`, "--jq", ".tree.sha")
  let devSha = null
  if (event === "push" && ref === "refs/heads/main") {
    // The dev→main merge commit: parent 1 is main, parent 2 is the dev head.
    devSha = gh(`repos/${repo}/commits/${sha}`, "--jq", ".parents[1].sha // empty") || null
  } else if (event === "pull_request" && baseRef === "main") {
    devSha = headSha
  }
  if (!devSha) return null
  const treeMatches = tree(sha) === tree(devSha)
  // Waiting only pays off when the tree matches; a push to main promotes a
  // commit its release PR already waited for, so it looks once.
  const deadline = now() + (treeMatches && event === "pull_request" ? waitMs : 0)
  let state = devRunState(gh, repo, devSha)
  while ((state === "pending" || state === "none") && now() < deadline) {
    sleep(POLL_MS)
    state = devRunState(gh, repo, devSha)
  }
  const runState = state === "pending" || state === "none" ? (event === "pull_request" && treeMatches ? "timeout" : state) : state
  return { treeMatches, runGreen: state === "green", runState }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env
  const facts = { event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, baseRef: env.BASE_REF ?? "", headSha: env.HEAD_SHA, sha: env.GITHUB_SHA, repo: env.GITHUB_REPOSITORY }
  let decision
  try {
    decision = decideMode({ ...facts, tested: gatherTested(facts), enforce: env.TEST_SELECT_ENFORCE === "true" })
  } catch (err) {
    decision = { mode: "full", reason: `could not check the dev run (${String(err.message).split("\n")[0]}) — running everything` }
  }
  appendFileSync(env.GITHUB_OUTPUT, `mode=${decision.mode}\nreason=${decision.reason.replace(/\n/g, " ")}\n`)
  process.stdout.write(`${decision.mode}: ${decision.reason}\n`)
}
