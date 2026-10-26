// tools/__tests__/test-select-ci-mode.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { decideMode, devRunState, gatherTested, RELEASE_WAIT_MS } from "../test-select/ci-mode.mjs"

const ok = { treeMatches: true, runGreen: true }

test("PR into dev → affected only when enforcement is on; push to dev → post-merge (the full suite, no coverage — that runs nightly)", () => {
  const pr = { event: "pull_request", ref: "refs/pull/1/merge", baseRef: "dev", tested: null }
  assert.equal(decideMode({ ...pr, enforce: true }).mode, "affected")
  assert.equal(decideMode({ ...pr, enforce: true }).reason, "PR into dev: only the tests this change can affect; the full suite runs after merge")
  const dev = decideMode({ event: "push", ref: "refs/heads/dev", baseRef: "", tested: null })
  assert.equal(dev.mode, "post-merge")
  assert.equal(dev.reason, "post-merge: the full suite runs on every dev commit")
})

test("PR into dev without enforcement → shadow: the full suite runs and the selection is only reported", () => {
  const pr = { event: "pull_request", ref: "refs/pull/1/merge", baseRef: "dev", tested: null }
  for (const enforce of [false, undefined, "true", 1]) {
    const d = decideMode({ ...pr, enforce })
    assert.equal(d.mode, "shadow", String(enforce))
    assert.equal(d.reason, "PR into dev, shadow mode: the full suite runs; the selector's choice is reported and checked for misses (enforcement: repository variable TEST_SELECT_ENFORCE=true)")
  }
})

test("enforce changes nothing outside PRs into dev", () => {
  for (const enforce of [true, false, undefined]) {
    assert.equal(decideMode({ event: "push", ref: "refs/heads/dev", baseRef: "", tested: null, enforce }).mode, "post-merge")
    assert.equal(decideMode({ event: "push", ref: "refs/heads/main", baseRef: "", tested: ok, enforce }).mode, "verified")
    assert.equal(decideMode({ event: "pull_request", ref: "refs/pull/2/merge", baseRef: "main", tested: null, enforce }).mode, "full")
    assert.equal(decideMode({ event: "pull_request", ref: "refs/pull/2/merge", baseRef: "feat/x", tested: null, enforce }).mode, "full")
    assert.equal(decideMode({ event: "workflow_dispatch", ref: "refs/heads/x", baseRef: "", tested: null, enforce }).mode, "full")
  }
})

test("PR into main and push to main are verified only when the identical tree passed on dev", () => {
  assert.equal(decideMode({ event: "pull_request", ref: "refs/pull/2/merge", baseRef: "main", tested: ok }).mode, "verified")
  assert.equal(decideMode({ event: "push", ref: "refs/heads/main", baseRef: "", tested: ok }).mode, "verified")
})

test("REVIEW FOCUS 5: any gap in the proof → full", () => {
  for (const tested of [null, { treeMatches: false, runGreen: true }, { treeMatches: true, runGreen: false }]) {
    assert.equal(decideMode({ event: "push", ref: "refs/heads/main", baseRef: "", tested }).mode, "full")
    assert.equal(decideMode({ event: "pull_request", ref: "refs/pull/2/merge", baseRef: "main", tested }).mode, "full")
  }
  assert.equal(decideMode({ event: "workflow_dispatch", ref: "refs/heads/x", baseRef: "", tested: null }).mode, "full")
})

// A stand-in for `gh api <path> --jq <filter>`: answers by path, trimmed like the real one.
const fakeGh = (answers, calls = []) => (path, ...rest) => {
  calls.push([path, ...rest])
  const hit = Object.entries(answers).find(([p]) => path === p)
  if (!hit) throw new Error(`unexpected gh call ${path}`)
  return hit[1]
}
const RUNS = (sha) => `repos/o/r/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=dev&per_page=10`

test("gatherTested: a dev→main merge whose tree is dev's, with a green dev run → proven", () => {
  const calls = []
  const gh = fakeGh({
    "repos/o/r/commits/m1": "d1",
    "repos/o/r/git/commits/m1": "T",
    "repos/o/r/git/commits/d1": "T",
    [RUNS("d1")]: "completed:success",
  }, calls)
  assert.deepEqual(gatherTested({ event: "push", ref: "refs/heads/main", baseRef: "", sha: "m1", repo: "o/r" }, gh), { treeMatches: true, runGreen: true, runState: "green" })
  assert.deepEqual(calls[0], ["repos/o/r/commits/m1", "--jq", ".parents[1].sha // empty"])
})

test("gatherTested: a squash merge into main has no second parent → nothing to compare with", () => {
  const gh = fakeGh({ "repos/o/r/commits/m2": "" })
  assert.equal(gatherTested({ event: "push", ref: "refs/heads/main", baseRef: "", sha: "m2", repo: "o/r" }, gh), null)
})

test("gatherTested: a PR into main whose merge tree differs from its head → tree does not match", () => {
  const gh = fakeGh({
    "repos/o/r/git/commits/merge1": "T-merge",
    "repos/o/r/git/commits/h1": "T-head",
    [RUNS("h1")]: "completed:success",
  })
  const tested = gatherTested({ event: "pull_request", ref: "refs/pull/3/merge", baseRef: "main", headSha: "h1", sha: "merge1", repo: "o/r" }, gh)
  assert.equal(tested.treeMatches, false)
  assert.equal(decideMode({ event: "pull_request", baseRef: "main", tested }).mode, "full")
})

test("gatherTested: no green dev run → runGreen false; PR into dev never asks GitHub", () => {
  const gh = fakeGh({ "repos/o/r/git/commits/merge1": "T", "repos/o/r/git/commits/h1": "T", [RUNS("h1")]: "completed:failure" })
  assert.equal(gatherTested({ event: "pull_request", baseRef: "main", headSha: "h1", sha: "merge1", repo: "o/r" }, gh).runGreen, false)
  assert.equal(gatherTested({ event: "pull_request", baseRef: "dev", headSha: "h1", sha: "merge1", repo: "o/r" }, fakeGh({})), null)
})

// A release PR is opened or moved by the dev push whose run it needs, seconds
// after that run starts. It waits for that run rather than running beside it.
function sequencedGh(states) {
  let i = 0
  const answers = { "repos/o/r/git/commits/merge1": "T", "repos/o/r/git/commits/h1": "T" }
  return (path) => {
    if (path in answers) return answers[path]
    if (path === RUNS("h1")) return states[Math.min(i++, states.length - 1)]
    throw new Error(`unexpected gh call ${path}`)
  }
}
function fakeClock() {
  let t = 0
  return { now: () => t, sleep: (ms) => { t += ms }, slept: () => t }
}
const release = { event: "pull_request", baseRef: "main", headSha: "h1", sha: "merge1", repo: "o/r" }

test("devRunState reads every run on the commit", () => {
  const at = (answer) => devRunState(() => answer, "o/r", "x")
  assert.equal(at(""), "none")
  assert.equal(at("completed:success"), "green")
  assert.equal(at("completed:cancelled,completed:success"), "green")
  assert.equal(at("in_progress:"), "pending")
  assert.equal(at("queued:"), "pending")
  assert.equal(at("completed:cancelled"), "dropped")
  assert.equal(at("completed:failure"), "failed")
  assert.equal(at("completed:cancelled,completed:failure"), "failed")
})

test("release PR: the dev run appears, runs, then passes → verified, after waiting", () => {
  const clock = fakeClock()
  const tested = gatherTested(release, sequencedGh(["", "queued:", "in_progress:", "completed:success"]), clock)
  assert.deepEqual(tested, { treeMatches: true, runGreen: true, runState: "green" })
  assert.equal(decideMode({ ...release, tested }).mode, "verified")
  assert.ok(clock.slept() > 0)
})

test("release PR: the dev run fails or is dropped → full, saying why", () => {
  for (const [last, state, words] of [["completed:failure", "failed", "failed"], ["completed:cancelled", "dropped", "dropped for a newer dev commit"]]) {
    const tested = gatherTested(release, sequencedGh(["in_progress:", last]), fakeClock())
    assert.equal(tested.runState, state)
    const d = decideMode({ ...release, tested })
    assert.equal(d.mode, "full")
    assert.match(d.reason, new RegExp(words))
  }
})

test("release PR: a dev run that never finishes stops the wait at the bound → full", () => {
  const clock = fakeClock()
  const tested = gatherTested(release, sequencedGh(["in_progress:"]), clock)
  assert.equal(tested.runState, "timeout")
  assert.ok(clock.slept() >= RELEASE_WAIT_MS && clock.slept() < RELEASE_WAIT_MS + 60_000)
  assert.match(decideMode({ ...release, tested }).reason, /did not finish in time/)
})

test("no wait when the tree differs, or on a push to main", () => {
  const differs = (path) => ({ "repos/o/r/git/commits/merge1": "T1", "repos/o/r/git/commits/h1": "T2", [RUNS("h1")]: "in_progress:" })[path]
  const clock = fakeClock()
  assert.equal(gatherTested(release, differs, clock).treeMatches, false)
  assert.equal(clock.slept(), 0)
  const push = (path) => ({ "repos/o/r/commits/m1": "h1", "repos/o/r/git/commits/m1": "T", "repos/o/r/git/commits/h1": "T", [RUNS("h1")]: "in_progress:" })[path]
  const c2 = fakeClock()
  assert.equal(gatherTested({ event: "push", ref: "refs/heads/main", baseRef: "", sha: "m1", repo: "o/r" }, push, c2).runGreen, false)
  assert.equal(c2.slept(), 0)
})
