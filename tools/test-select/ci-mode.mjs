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
  if (!tested.runGreen) return { mode: "full", reason: "the dev commit with this tree has no green full run — running everything" }
  return { mode: "verified", reason: "this exact tree already passed the full suite on dev" }
}

// ci-mode runs on GitHub-hosted runners, which ship `gh`.
function realGh(...args) {
  return execFileSync("gh", ["api", ...args], { encoding: "utf8" }).trim()
}

// Which dev commit this run promotes, and whether that commit's exact tree
// already passed CI on dev. `gh` is injectable for tests.
export function gatherTested({ event, ref, baseRef, headSha, sha, repo }, gh = realGh) {
  const tree = (s) => gh(`repos/${repo}/git/commits/${s}`, "--jq", ".tree.sha")
  let devSha = null
  if (event === "push" && ref === "refs/heads/main") {
    // The dev→main merge commit: parent 1 is main, parent 2 is the dev head.
    devSha = gh(`repos/${repo}/commits/${sha}`, "--jq", ".parents[1].sha // empty") || null
  } else if (event === "pull_request" && baseRef === "main") {
    devSha = headSha
  }
  if (!devSha) return null
  const runs = gh(`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${devSha}&event=push&branch=dev&status=success&per_page=1`, "--jq", ".total_count")
  return { treeMatches: tree(sha) === tree(devSha), runGreen: Number(runs) > 0 }
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
