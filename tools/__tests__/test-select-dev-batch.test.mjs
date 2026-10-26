// tools/__tests__/test-select-dev-batch.test.mjs
// One post-merge dev run covers every merge since the last dev commit whose
// run FINISHED: the dev group of CI drops the pending runs in between.
import { test } from "node:test"
import assert from "node:assert/strict"
import { findBatch, MAX_BATCH } from "../test-select/dev-batch.mjs"
import { buildAttributionComment } from "../test-select/attribution.mjs"

const runsOf = (states) => (path) => {
  const sha = /head_sha=([^&]+)/.exec(path)?.[1]
  if (!(sha in states)) throw new Error(`unexpected gh call ${path}`)
  return states[sha]
}

test("the batch runs back to the last commit whose run finished — green or red", () => {
  const firstParents = ["s4", "s3", "s2", "s1", "s0"]
  const gh = runsOf({ s3: "completed:cancelled", s2: "completed:cancelled", s1: "completed:success" })
  assert.deepEqual(findBatch({ sha: "s4", repo: "o/r", firstParents, gh }), { last: "s1", lastState: "green", batch: ["s2", "s3", "s4"] })
  const red = runsOf({ s3: "completed:failure" })
  assert.deepEqual(findBatch({ sha: "s4", repo: "o/r", firstParents, gh: red }), { last: "s3", lastState: "failed", batch: ["s4"] })
})

test("a parent still running is part of this batch's uncertainty, not its baseline", () => {
  const gh = runsOf({ b: "in_progress:", a: "completed:success" })
  assert.deepEqual(findBatch({ sha: "c", repo: "o/r", firstParents: ["c", "b", "a"], gh }), { last: "a", lastState: "green", batch: ["b", "c"] })
})

test("no finished run within reach → unknown baseline, bounded walk", () => {
  const firstParents = Array.from({ length: MAX_BATCH + 5 }, (_, i) => `c${i}`)
  const calls = []
  const gh = (path) => { calls.push(path); return "" }
  const r = findBatch({ sha: "c0", repo: "o/r", firstParents, gh })
  assert.equal(r.last, null)
  assert.equal(r.lastState, "none")
  assert.equal(calls.length, MAX_BATCH)
})

test("attribution names every merge a batched run covered", () => {
  const md = buildAttributionComment({
    sha: "s4aaaaaaa", before: "s1aaaaaaa", runUrl: "u", previousConclusion: "success",
    failed: { frontend: ["src/a.test.ts"], backend: [] },
    merges: [{ sha: "s2aaaaaaa", pr: 11 }, { sha: "s3aaaaaaa", pr: 12 }, { sha: "s4aaaaaaa", pr: 13 }],
  })
  assert.match(md, /\(3 merges, this PR's among them\)/)
  assert.match(md, /- `s2aaaaa` #11\n- `s3aaaaa` #12\n- `s4aaaaa` #13/)
  assert.match(md, /one of these 3 merges is the likely cause/)
  assert.match(md, /revert the PR that broke it/)
  // A run covering one merge reads exactly as before.
  const one = buildAttributionComment({ sha: "s4", before: "s3", runUrl: "u", previousConclusion: "success", failed: { frontend: ["x"], backend: [] }, merges: [{ sha: "s4", pr: 13 }] })
  assert.match(one, /\(this PR's merge\)/)
  assert.match(one, /this merge is the likely cause/)
  assert.doesNotMatch(one, /covered every merge/)
})
