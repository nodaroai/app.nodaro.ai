// tools/__tests__/test-select-reporting.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { renderSummary } from "../test-select/summary.mjs"
import { failedFiles } from "../test-select/failed-files.mjs"
import { buildAttributionComment, failedJobsFrom } from "../test-select/attribution.mjs"
import { readFailedLists } from "../test-select/failed-lists.mjs"
import { compareShadow, runShadowCheck } from "../test-select/shadow-check.mjs"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

test("summary: affected mode says how many ran, out of how many, and why", () => {
  const md = renderSummary("frontend", {
    mode: "affected", reason: "2 of 1364 test files can be affected", total: 1364,
    files: [{ file: "frontend/src/a.test.ts", why: "imports frontend/src/a.ts" }, { file: "frontend/src/b.test.ts", why: "watches frontend/src/b.tsx" }],
  })
  assert.match(md, /### Frontend Tests: affected/)
  assert.match(md, /Ran \*\*2\*\* of 1364 test files/)
  assert.match(md, /`frontend\/src\/a\.test\.ts` — imports frontend\/src\/a\.ts/)
})

test("summary: full mode carries the reason; the list is capped", () => {
  assert.match(renderSummary("backend", { mode: "full", reason: "package-lock.json can affect every test", files: [], total: 2055 }), /### Backend Tests: full\n\npackage-lock\.json/)
  const many = Array.from({ length: 300 }, (_, i) => ({ file: `f${i}`, why: "x" }))
  const md = renderSummary("backend", { mode: "affected", reason: "r", files: many, total: 2055 })
  assert.match(md, /…and 100 more/)
})

test("summary: shadow mode titles the block with what the selector would have run, and keeps its list", () => {
  const result = { mode: "affected", reason: "1 of 9 test files can be affected", total: 9, files: [{ file: "backend/src/a.test.ts", why: "imports backend/src/a.ts" }] }
  const md = renderSummary("backend", result, { shadow: true })
  assert.match(md, /^### Backend Tests: shadow \(would run: affected\)\n/)
  // nothing was skipped in shadow mode: the block never says "Ran"
  assert.match(md, /Would run \*\*1\*\* of 9 test files\./)
  assert.match(md, /<details><summary>Files it would run and why<\/summary>/)
  assert.doesNotMatch(md, /Ran \*\*|Selected files and why/)
  assert.match(md, /`backend\/src\/a\.test\.ts` — imports backend\/src\/a\.ts/)
  assert.match(renderSummary("frontend", { mode: "none", reason: "r", files: [], total: 9 }, { shadow: true }), /^### Frontend Tests: shadow \(would run: none\)\n\nr\n/)
  assert.match(renderSummary("frontend", { mode: "full", reason: "r", files: [], total: 9 }, { shadow: true }), /^### Frontend Tests: shadow \(would run: full\)/)
  // no option, or shadow false: the title is unchanged
  assert.match(renderSummary("backend", result, { shadow: false }), /^### Backend Tests: affected\n/)
})

test("shadow check: full would have run everything — no miss", () => {
  assert.deepEqual(compareShadow({ failed: ["src/a.test.ts"], selected: [], wouldRun: "full" }), { misses: [], checked: 1 })
})

test("shadow check: none would have run nothing — every failed file is a miss", () => {
  assert.deepEqual(compareShadow({ failed: ["src/a.test.ts", "src/b.test.ts"], selected: [], wouldRun: "none" }), { misses: ["src/a.test.ts", "src/b.test.ts"], checked: 2 })
})

test("shadow check: affected misses exactly the failed files outside the selection", () => {
  assert.deepEqual(compareShadow({ failed: ["src/a.test.ts", "src/b.test.ts"], selected: ["src/a.test.ts", "src/c.test.ts"], wouldRun: "affected" }), { misses: ["src/b.test.ts"], checked: 2 })
  assert.deepEqual(compareShadow({ failed: ["src/a.test.ts"], selected: ["src/a.test.ts"], wouldRun: "affected" }), { misses: [], checked: 1 })
})

test("shadow check: empty inputs — nothing failed, nothing missed", () => {
  for (const wouldRun of ["affected", "none", "full"]) {
    assert.deepEqual(compareShadow({ failed: [], selected: [], wouldRun }), { misses: [], checked: 0 })
  }
  assert.deepEqual(compareShadow({ failed: ["src/a.test.ts"], selected: [], wouldRun: "affected" }), { misses: ["src/a.test.ts"], checked: 1 })
})

test("shadow check: an unknown wouldRun is an error, never a silent pass", () => {
  assert.throws(() => compareShadow({ failed: ["src/a.test.ts"], selected: [], wouldRun: "" }), /unknown/)
})

// A shadow check against files on disk; report: object, null (none written)
// or a string (written verbatim).
function shadowCheck({ report, list = "", wouldRun = "affected", rc, unhandled }) {
  const dir = mkdtempSync(path.join(tmpdir(), "shadow-check-"))
  const f = (name) => path.join(dir, name)
  if (report !== null) writeFileSync(f("report.json"), typeof report === "string" ? report : JSON.stringify(report))
  writeFileSync(f("list.txt"), list)
  writeFileSync(f("summary.md"), "")
  const args = [f("report.json"), f("list.txt"), wouldRun, f("out.json"), f("summary.md"), "backend"]
  if (rc !== undefined || unhandled !== undefined) args.push(rc === undefined ? "" : String(rc))
  if (unhandled !== undefined) args.push(unhandled ? "1" : "0")
  runShadowCheck(args, dir)
  return { out: JSON.parse(readFileSync(f("out.json"), "utf8")), summary: readFileSync(f("summary.md"), "utf8") }
}

test("shadow check: a failed run with no failing test file is unattributed — a possible miss, never clean", () => {
  const { out, summary } = shadowCheck({ report: { testResults: [] }, rc: 1 })
  assert.equal(out.unattributed, true)
  assert.deepEqual(out.misses, [])
  assert.match(summary, /the run failed without a failing test file \(unhandled error or crash\) — not attributable to a file; counted as a possible miss/)
})

test("shadow check: a failed run whose report was never written is unattributed too (and reports the error)", () => {
  const { out, summary } = shadowCheck({ report: null, rc: 1 })
  assert.equal(out.unattributed, true)
  assert.match(out.error, /ENOENT/)
  assert.match(summary, /counted as a possible miss/)
})

test("shadow check: an unhandled error makes the run unattributed even when failing files explain part of it", () => {
  const failing = { testResults: [{ status: "failed", name: path.join(tmpdir(), "x.test.ts") }] }
  const { out, summary } = shadowCheck({ report: failing, rc: 1, unhandled: true })
  assert.equal(out.unattributed, true)
  assert.match(summary, /Vitest reported an unhandled error — not attributable to a file; counted as a possible miss/)
  assert.equal(shadowCheck({ report: failing, rc: 1, unhandled: false }).out.unattributed, undefined)
})

test("shadow check: a failing test file, or a green run, is never unattributed", () => {
  const failing = shadowCheck({ report: { testResults: [{ status: "failed", name: path.join(tmpdir(), "x.test.ts") }] }, rc: 1 })
  assert.equal(failing.out.unattributed, undefined)
  const green = shadowCheck({ report: { testResults: [] }, rc: 0 })
  assert.equal(green.out.unattributed, undefined)
  assert.doesNotMatch(green.summary, /possible miss/)
  // no exit code given (an older caller): nothing is inferred
  assert.equal(shadowCheck({ report: { testResults: [] } }).out.unattributed, undefined)
})

test("failed files: only failed suites, relative to the project directory", () => {
  const report = { testResults: [
    { name: "/w/frontend/src/a.test.ts", status: "failed" },
    { name: "/w/frontend/src/b.test.ts", status: "passed" },
  ] }
  assert.deepEqual(failedFiles(report, "/w/frontend"), ["src/a.test.ts"])
  assert.deepEqual(failedFiles({}, "/w/frontend"), [])
})

test("attribution: files that failed again and files that passed alone are listed apart", () => {
  const md = buildAttributionComment({
    sha: "abc1234def", before: "999aaaa111", runUrl: "https://x/run/1", previousConclusion: "success",
    failed: { frontend: ["src/a.test.ts"], backend: [] },
    flaky: { frontend: [], backend: ["src/f.test.ts"] },
  })
  assert.match(md, /Failed again when re-run alone[^\n]*:\n- frontend: `src\/a\.test\.ts`\n/)
  assert.match(md, /Passed when re-run alone — likely flaky \(dev stays red until it is fixed or the run is re-run\):\n- backend: `src\/f\.test\.ts`/)
  // a real failure remains: the merge is still the likely cause
  assert.match(md, /this merge is the likely cause/)
  assert.match(md, /`dev → main` stays blocked/)
})

test("attribution: when every failure passed alone, the verdict says flaky — and dev → main stays blocked", () => {
  const md = buildAttributionComment({
    sha: "abc1234def", before: "999aaaa111", runUrl: "https://x/run/1", previousConclusion: "success",
    failed: { frontend: [], backend: [] },
    flaky: { frontend: ["src/a.test.ts"], backend: [] },
  })
  assert.match(md, /looks flaky/)
  assert.doesNotMatch(md, /likely cause/)
  assert.doesNotMatch(md, /not captured/)
  assert.doesNotMatch(md, /Failed again when re-run alone/)
  assert.match(md, /- frontend: `src\/a\.test\.ts`/)
  assert.match(md, /`dev → main` stays blocked until the full suite on dev is green/)
})

test("attribution: files whose re-run crashed are listed as unknown, not as failed again — and are not flaky", () => {
  const md = buildAttributionComment({
    sha: "abc1234def", before: "999aaaa111", runUrl: "https://x/run/1", previousConclusion: "success",
    failed: { frontend: [], backend: [] },
    unknown: { frontend: ["src/a.test.ts"], backend: [] },
  })
  assert.match(md, /Re-run alone gave no result \(it crashed without a report\) — status unknown:\n- frontend: `src\/a\.test\.ts`/)
  assert.doesNotMatch(md, /Failed again when re-run alone/)
  assert.doesNotMatch(md, /looks flaky|not captured/)
  assert.match(md, /this merge is the likely cause/)
})

test("attribution: nothing captured in either list says so; flaky defaults to empty", () => {
  const md = buildAttributionComment({ sha: "a", before: "b", runUrl: "u", previousConclusion: "none", failed: { frontend: [], backend: [] } })
  assert.match(md, /not captured — see the run/)
  assert.doesNotMatch(md, /likely flaky/)
})

// The post-merge run 39120351077 (PR #2332): one failing shard uploaded an
// empty failed-frontend.txt, the file in .flaky, and an empty .unknown. One
// matching artifact is extracted straight into the download directory, several
// into one subdirectory each — the lists are read from either layout.
const OVERLAY = "src/components/editor/config-panels/__tests__/video-overlay-config.test.tsx"
function writeShard(dir, project, { failed = "", flaky = "", unknown = "" }) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `failed-${project}.txt`), failed)
  writeFileSync(path.join(dir, `failed-${project}.txt.flaky`), flaky)
  writeFileSync(path.join(dir, `failed-${project}.txt.unknown`), unknown)
}
const comment = (dir) => buildAttributionComment({ sha: "abc1234def", before: "999aaaa111", runUrl: "u", previousConclusion: "success", ...readFailedLists(dir) })

test("attribution lists: one failing shard (extracted flat) — the flaky file is listed, labelled likely flaky", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "failed-"))
  writeShard(dir, "frontend", { flaky: `${OVERLAY}\n` })
  assert.deepEqual(readFailedLists(dir), {
    failed: { frontend: [], backend: [] },
    flaky: { frontend: [OVERLAY], backend: [] },
    unknown: { frontend: [], backend: [] },
  })
  const md = comment(dir)
  assert.match(md, /likely flaky[^\n]*:\n- frontend: `src\/components\/editor\/config-panels\/__tests__\/video-overlay-config\.test\.tsx`\n/)
  assert.doesNotMatch(md, /not captured/)
})

test("attribution lists: several shards (one subdirectory each) — every file under its label: failed again, likely flaky, unknown", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "failed-"))
  writeShard(path.join(dir, "failed-frontend-1"), "frontend", { flaky: `${OVERLAY}\n` })
  writeShard(path.join(dir, "failed-frontend-3"), "frontend", { failed: "src/a.test.ts\n", unknown: "src/u.test.ts\n" })
  writeShard(path.join(dir, "failed-backend-2"), "backend", { failed: "src/b.test.ts\nsrc/c.test.ts\n" })
  const lists = readFailedLists(dir)
  assert.deepEqual(lists, {
    failed: { frontend: ["src/a.test.ts"], backend: ["src/b.test.ts", "src/c.test.ts"] },
    flaky: { frontend: [OVERLAY], backend: [] },
    unknown: { frontend: ["src/u.test.ts"], backend: [] },
  })
  const md = comment(dir)
  assert.match(md, /Failed again when re-run alone[^\n]*:\n- frontend: `src\/a\.test\.ts`\n- backend: `src\/b\.test\.ts`\n- backend: `src\/c\.test\.ts`\n/)
  assert.match(md, /status unknown:\n- frontend: `src\/u\.test\.ts`\n/)
  assert.match(md, /likely flaky[^\n]*:\n- frontend: `src\/components\/editor\/config-panels\/__tests__\/video-overlay-config\.test\.tsx`\n/)
  assert.doesNotMatch(md, /not captured/)
})

test("attribution lists: empty lists, or no artifact at all, still say not captured", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "failed-"))
  writeShard(dir, "frontend", {})
  assert.match(comment(dir), /not captured — see the run/)
  assert.match(comment(path.join(dir, "never-downloaded")), /not captured — see the run/)
})

test("attribution: the wording follows the previous dev commit's result", () => {
  const base = { sha: "abc1234def", before: "999aaaa111", runUrl: "https://x/run/1", failed: { frontend: ["src/a.test.ts"], backend: [] } }
  assert.match(buildAttributionComment({ ...base, previousConclusion: "success" }), /previous dev commit `999aaaa` passed.*likely cause/s)
  assert.match(buildAttributionComment({ ...base, previousConclusion: "failure" }), /already red/)
  assert.match(buildAttributionComment({ ...base, previousConclusion: "none" }), /cannot be attributed with certainty/)
  assert.match(buildAttributionComment({ ...base, previousConclusion: "success" }), /- frontend: `src\/a\.test\.ts`/)
})

// The jobs gated by tools/ci/job-inputs.json upload no file lists: a failure
// of one is named, never read as "not captured" or as a flake (decided 2026-10-20).
test("attribution: a failed gated job is named; a skipped or passing one is not a failure", () => {
  assert.deepEqual(failedJobsFrom({
    "frontend-tests": { result: "success" }, "backend-tests": { result: "skipped" },
    "remotion-tests": { result: "skipped" }, characterize: { result: "failure" },
    "migration-behavior": { result: "cancelled" }, "ffmpeg-ledger-redis": { result: "failure" },
  }), ["characterize", "ffmpeg-ledger-redis"])
  assert.deepEqual(failedJobsFrom(undefined), [])
  const base = { sha: "abc1234def", before: "999aaaa111", runUrl: "u", previousConclusion: "success", failed: { frontend: [], backend: [] } }
  const only = buildAttributionComment({ ...base, failedJobs: ["characterize"] })
  assert.match(only, /Failed jobs \(see the run for their output\):\n- `characterize`\n/)
  assert.doesNotMatch(only, /not captured/)
  assert.match(only, /this merge is the likely cause/)
  // a gated job's failure is never masked by a suite file that passed alone
  const withFlake = buildAttributionComment({ ...base, failedJobs: ["remotion-tests", "frontend-tests"], flaky: { frontend: ["src/a.test.ts"], backend: [] } })
  assert.doesNotMatch(withFlake, /looks flaky/)
  assert.match(withFlake, /- `remotion-tests`/)
  assert.doesNotMatch(withFlake, /- `frontend-tests`/, "a suite's failure is told by its files")
  // a suite failure with no captured file still says so
  assert.match(buildAttributionComment({ ...base, failedJobs: ["backend-tests", "characterize"] }), /not captured — see the run/)
})
