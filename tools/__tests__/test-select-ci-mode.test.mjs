// tools/__tests__/test-select-ci-mode.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { decideMode, gatherTested } from "../test-select/ci-mode.mjs"

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
const RUNS = (sha) => `repos/o/r/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=dev&status=success&per_page=1`

test("gatherTested: a dev→main merge whose tree is dev's, with a green dev run → proven", () => {
  const calls = []
  const gh = fakeGh({
    "repos/o/r/commits/m1": "d1",
    "repos/o/r/git/commits/m1": "T",
    "repos/o/r/git/commits/d1": "T",
    [RUNS("d1")]: "1",
  }, calls)
  assert.deepEqual(gatherTested({ event: "push", ref: "refs/heads/main", baseRef: "", sha: "m1", repo: "o/r" }, gh), { treeMatches: true, runGreen: true })
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
    [RUNS("h1")]: "1",
  })
  const tested = gatherTested({ event: "pull_request", ref: "refs/pull/3/merge", baseRef: "main", headSha: "h1", sha: "merge1", repo: "o/r" }, gh)
  assert.equal(tested.treeMatches, false)
  assert.equal(decideMode({ event: "pull_request", baseRef: "main", tested }).mode, "full")
})

test("gatherTested: no green dev run → runGreen false; PR into dev never asks GitHub", () => {
  const gh = fakeGh({ "repos/o/r/git/commits/merge1": "T", "repos/o/r/git/commits/h1": "T", [RUNS("h1")]: "0" })
  assert.equal(gatherTested({ event: "pull_request", baseRef: "main", headSha: "h1", sha: "merge1", repo: "o/r" }, gh).runGreen, false)
  assert.equal(gatherTested({ event: "pull_request", baseRef: "dev", headSha: "h1", sha: "merge1", repo: "o/r" }, fakeGh({})), null)
})
