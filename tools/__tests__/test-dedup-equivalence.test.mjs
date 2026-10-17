// tools/__tests__/test-dedup-equivalence.test.mjs
// The proof harness (tools/test-dedup/) on planted cases. Runs with no npm ci:
// the verdict core is pure, the end-to-end cases drive node:test fixtures
// through the same orchestration the Vitest runner uses, with precomputed
// mutation sites (sites.json, sites-names.json) — only the checks of the
// mutator itself need the repo's `typescript`, and they say so when they skip.
// The same probes through the REAL Vitest runner (and the CLI) are in
// test-dedup-equivalence-vitest.test.mjs, which needs node_modules.
// @test-watches tools/test-dedup/** tools/__tests__/fixtures/test-dedup/** tools/test-select/annotations.mjs tools/__tests__/test-dedup-equivalence-vitest.test.mjs .github/workflows/ci.yml
import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { collectionChanged, detected, idCounts, packagesTouched, proveGuard, proveMerge, proveRemoval, selectionProblem, strangers } from "../test-dedup/equivalence.mjs"
import { applySite, describeSite, parseSubject } from "../test-dedup/mutate.mjs"
import { createNodeTestRunner, namePattern } from "../test-dedup/runners.mjs"
import {
  censusDiff, coverageDiff, guardVerdict, killVerdict, renderGuard, renderMerge, renderRemove, resolveTests, staticsDiff,
  strykerMatrix, strykerReportProblem,
} from "../test-dedup/verdicts.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../..")
const fixture = path.join(here, "fixtures/test-dedup")
const sites = JSON.parse(readFileSync(path.join(fixture, "sites.json"), "utf8"))
const namesSites = JSON.parse(readFileSync(path.join(fixture, "sites-names.json"), "utf8"))
const readSource = (file) => readFileSync(path.join(fixture, file), "utf8")

const ev = (label, killedBy, extra = {}) => ({ label, outcome: "evaluated", killedBy, ...extra })

// ---- remove: the verdict core ----------------------------------------------

test("killVerdict: keepers kill everything the candidate kills → proven (exit 0)", () => {
  const r = killVerdict({ mutants: [ev("m1", ["c", "k"]), ev("m2", ["k"]), ev("m3", [])], candidateIds: ["c"], keeperIds: ["k"] })
  assert.equal(r.verdict, "proven")
  assert.equal(r.exitCode, 0)
  assert.equal(r.candidateKills, 1)
})

test("killVerdict: a mutant only the candidate kills → not-proven, naming it (exit 1)", () => {
  const r = killVerdict({ mutants: [ev("m1", ["c", "k"]), ev("only-c", ["c"])], candidateIds: ["c"], keeperIds: ["k"] })
  assert.equal(r.verdict, "not-proven")
  assert.equal(r.exitCode, 1)
  assert.deepEqual(r.unique.map((m) => m.label), ["only-c"])
})

test("killVerdict: the candidate never counts as its own keeper", () => {
  const r = killVerdict({ mutants: [ev("m", ["c"])], candidateIds: ["c"], keeperIds: ["c", "k"] })
  assert.equal(r.verdict, "not-proven")
})

test("killVerdict: a timeout the candidate may reach is unresolved; one it cannot reach (Stryker coveredBy) is not", () => {
  const unresolved = killVerdict({ mutants: [ev("m1", ["c", "k"]), { label: "loop", outcome: "timeout", killedBy: [] }], candidateIds: ["c"], keeperIds: ["k"] })
  assert.equal(unresolved.verdict, "unresolved")
  assert.equal(unresolved.exitCode, 2)
  const cleared = killVerdict({ mutants: [ev("m1", ["c", "k"]), { label: "loop", outcome: "timeout", killedBy: [], coveredBy: ["k"] }], candidateIds: ["c"], keeperIds: ["k"] })
  assert.equal(cleared.verdict, "proven")
})

test("killVerdict: a candidate that kills nothing is vacuous, never proven", () => {
  const r = killVerdict({ mutants: [ev("m1", ["k"])], candidateIds: ["c"], keeperIds: ["k"] })
  assert.equal(r.verdict, "vacuous")
  assert.equal(r.exitCode, 2)
})

test("killVerdict: static mutants are reported as unevaluated, not as survivors", () => {
  const r = killVerdict({ mutants: [ev("m1", ["c", "k"]), { label: "s", outcome: "static", killedBy: [] }], candidateIds: ["c"], keeperIds: ["k"] })
  assert.equal(r.verdict, "proven")
  assert.equal(r.unevaluated.length, 1)
})

test("resolveTests: full name, unique title, and refusals for a typo or an ambiguous title", () => {
  const tests = [
    { id: "f.test.ts#a > x", file: "f.test.ts", name: "a > x" },
    { id: "f.test.ts#b > x", file: "f.test.ts", name: "b > x" },
    { id: "f.test.ts#b > y", file: "f.test.ts", name: "b > y" },
  ]
  assert.deepEqual(resolveTests(tests, "f.test.ts#b > x"), ["f.test.ts#b > x"])
  assert.deepEqual(resolveTests(tests, "f.test.ts#b x"), ["f.test.ts#b > x"], "Stryker's space-joined spelling")
  assert.deepEqual(resolveTests(tests, "f.test.ts#y"), ["f.test.ts#b > y"])
  assert.equal(resolveTests(tests, "f.test.ts").length, 3)
  assert.throws(() => resolveTests(tests, "f.test.ts#x"), /matches 2 tests/)
  assert.throws(() => resolveTests(tests, "f.test.ts#z"), /no test named/)
  assert.throws(() => resolveTests(tests, "g.test.ts"), /no test ran/)
})

test("strykerMatrix: killedBy/coveredBy become repo test ids; static and timeout keep their meaning", () => {
  const report = {
    testFiles: { "src/__tests__/a.test.ts": { tests: [{ id: "0", name: "suite keeps" }, { id: "1", name: "suite candidate" }] } },
    files: { "src/a.ts": { mutants: [
      { id: "m0", mutatorName: "StringLiteral", replacement: '""', status: "Killed", killedBy: ["1"], coveredBy: ["0", "1"], location: { start: { line: 3, column: 5 } } },
      { id: "m1", mutatorName: "ObjectLiteral", replacement: "{}", status: "Survived", static: true, coveredBy: [], location: { start: { line: 9, column: 1 } } },
      { id: "m2", mutatorName: "EqualityOperator", replacement: "<", status: "Timeout", coveredBy: ["0"], location: { start: { line: 4, column: 2 } } },
    ] } },
  }
  const { tests, mutants } = strykerMatrix(report, "backend")
  assert.equal(tests[1].id, "backend/src/__tests__/a.test.ts#suite candidate")
  assert.deepEqual(mutants.map((m) => m.outcome), ["evaluated", "static", "timeout"])
  const r = killVerdict({ mutants, candidateIds: resolveTests(tests, "backend/src/__tests__/a.test.ts#suite candidate"), keeperIds: [tests[0].id] })
  assert.equal(r.verdict, "not-proven")
  assert.match(r.unique[0].label, /^backend\/src\/a\.ts:3:5 StringLiteral/)
  assert.equal(r.unresolved.length, 0, "the timeout is covered only by the keeper")
})

// ---- remove: end to end on a planted fixture --------------------------------

async function removal(candidate, keepers) {
  const runner = await createNodeTestRunner({ fixtureDir: fixture })
  try {
    return await proveRemoval({ runner, candidate, keepers, sites, readSource })
  } finally {
    await runner.close()
  }
}

test("remove, planted: the remaining tests do NOT cover the removed one → NOT proven, naming the surviving mutants", async () => {
  const r = await removal("price.cases.mjs#an empty order is free", ["price.cases.mjs"])
  assert.equal(r.verdict, "not-proven")
  assert.equal(r.exitCode, 1)
  assert.deepEqual(r.unique.map((m) => m.label).sort(), [
    "price.mjs:3:24 literal `0` → `1`",
    "price.mjs:3:24 return `0` → `undefined`",
  ])
  const md = renderRemove({ candidate: "price.cases.mjs#an empty order is free", keepers: ["price.cases.mjs"], subjects: ["price.mjs"], producer: "fixture", result: r, durationMs: 1 })
  assert.match(md, /REFUTED/)
  assert.doesNotMatch(md, /PROVEN/, "a grep for PROVEN finds only a proof")
  assert.match(md, /price\.mjs:3:24 return `0` → `undefined`/)
})

test("remove, planted: a true copy → proven", async () => {
  const r = await removal("price.cases.mjs#discounts orders over 100 (copy)", ["price.cases.mjs"])
  assert.equal(r.verdict, "proven")
  assert.equal(r.exitCode, 0)
  assert.ok(r.candidateKills >= 4, `the copy kills ${r.candidateKills} mutants`)
})

test("remove: a keeper in another file (the second stage) covers the unique assertion → proven", async () => {
  const r = await removal("price.cases.mjs#an empty order is free", ["price.cases.mjs", "price-more.cases.mjs"])
  assert.equal(r.verdict, "proven")
  assert.ok(r.keeperIds.includes("price-more.cases.mjs#edge cases > an empty order costs nothing"))
})

test("remove: a failing baseline is refused (a proof needs green tests)", async () => {
  const runner = await createNodeTestRunner({ fixtureDir: fixture })
  try {
    const broken = { ...runner, run: async (files, o) => ((o?.overlay?.size ?? 0) === 0 ? runner.run(files, { overlay: new Map([["price.mjs", "export const price = () => -1\n"]]) }) : runner.run(files, o)) }
    await assert.rejects(proveRemoval({ runner: broken, candidate: "price.cases.mjs#an empty order is free", keepers: ["price.cases.mjs"], sites, readSource }), /baseline/)
  } finally {
    await runner.close()
  }
})

test("remove: a result from a file the run did not include is stale and never credits a keeper", async () => {
  const runner = await createNodeTestRunner({ fixtureDir: fixture })
  try {
    // merge-b's test never touches price(), so it is no real keeper. This
    // runner also reports it as failing under every mutant in runs that did
    // not include it — what a reused Vitest instance's accumulated module
    // state looked like.
    const staleId = "merge-b.cases.mjs#three"
    const stale = { ...runner, run: async (files, o) => {
      const r = await runner.run(files, o)
      if (files.includes("merge-b.cases.mjs") || (o?.overlay?.size ?? 0) === 0) return r
      return { ...r, tests: [...r.tests, { id: staleId, file: "merge-b.cases.mjs", name: "three", state: "failed" }] }
    } }
    const r = await proveRemoval({ runner: stale, candidate: "price.cases.mjs#an empty order is free", keepers: ["price.cases.mjs", "merge-b.cases.mjs"], sites, readSource })
    assert.ok(r.keeperIds.includes(staleId))
    assert.equal(r.verdict, "not-proven", "the stale merge-b failures must not count as keeper kills")
  } finally {
    await runner.close()
  }
})

test("mutate: a site applies only to the text it was computed from", () => {
  const site = sites.find((s) => s.operator === "compare")
  assert.match(applySite(readSource("price.mjs"), site), /if \(qty > 0\)/)
  assert.throws(() => applySite("// changed\n", site), /no longer matches/)
  assert.equal(describeSite(site), "price.mjs:3:11 compare `<=` → `>`")
  assert.deepEqual(parseSubject("a/b.ts:10-20"), { file: "a/b.ts", from: 10, to: 20 })
  assert.equal(parseSubject("a/b.ts").to, Number.POSITIVE_INFINITY)
})

test("mutate: sites.json is what the mutator computes today", (t) => {
  let ts
  try {
    ts = createRequire(path.join(repoRoot, "package.json"))("typescript")
  } catch {
    t.skip("typescript is not installed (this job runs without npm ci); covered wherever node_modules exists")
    return
  }
  return import("../test-dedup/mutate.mjs").then(({ mutationSites }) => {
    assert.deepEqual(mutationSites(ts, readSource("price.mjs"), "price.mjs"), sites,
      "Regenerate: node tools/test-dedup/mutate.mjs tools/__tests__/fixtures/test-dedup/price.mjs --as price.mjs > tools/__tests__/fixtures/test-dedup/sites.json")
  })
})

// ---- merge ------------------------------------------------------------------

test("censusDiff: wrapped merge with the same tests is equal; a lost title or a lost pass is not", () => {
  const before = [
    { file: "x/a.test.ts", name: "s > one", state: "passed" },
    { file: "x/b.test.ts", name: "two", state: "passed" },
  ]
  const ok = censusDiff({ before, after: [
    { file: "x/ab.test.ts", name: "a > s > one", state: "passed" },
    { file: "x/ab.test.ts", name: "b > two", state: "passed" },
  ] })
  assert.equal(ok.ok, true)
  assert.equal(ok.wrapped, true)
  const lost = censusDiff({ before, after: [{ file: "x/ab.test.ts", name: "a > s > one", state: "passed" }, { file: "x/ab.test.ts", name: "b > three", state: "passed" }] })
  assert.equal(lost.ok, false)
  assert.deepEqual(lost.missing, ["b :: two"])
  assert.deepEqual(lost.extra, ["b :: three"])
  const skipped = censusDiff({ before, after: [{ file: "x/ab.test.ts", name: "s > one", state: "passed" }, { file: "x/ab.test.ts", name: "two", state: "skipped" }] })
  assert.equal(skipped.wrapped, false)
  assert.equal(skipped.ok, false, "same names, one fewer pass")
})

test("coverageDiff: a covered line lost in the merge fails", () => {
  assert.equal(coverageDiff(new Map([["s.ts", new Set([1, 2])]]), new Map([["s.ts", new Set([1, 2])]])).ok, true)
  const d = coverageDiff(new Map([["s.ts", new Set([1, 2])]]), new Map([["s.ts", new Set([1])]]))
  assert.equal(d.ok, false)
  assert.deepEqual(d.rows[0].lost, [2])
})

async function merge(after) {
  const runner = await createNodeTestRunner({ fixtureDir: fixture })
  try {
    return await proveMerge({ runner, before: ["merge-a.cases.mjs", "merge-b.cases.mjs"], after })
  } finally {
    await runner.close()
  }
}

test("merge, end to end: wrapping each original file in a describe keeps the census", async () => {
  const r = await merge(["merged.cases.mjs"])
  assert.equal(r.ok, true, JSON.stringify(r.census))
  assert.equal(r.exitCode, 0)
  assert.equal(r.census.after.passed, 3)
})

test("merge, end to end: a test title that disappears fails, naming it", async () => {
  const r = await merge(["merged-lossy.cases.mjs"])
  assert.equal(r.ok, false)
  assert.equal(r.exitCode, 1)
  assert.deepEqual(r.census.missing, ["merge-a.cases.mjs :: a > two"])
  assert.match(renderMerge({ beforeFiles: ["merge-a.cases.mjs", "merge-b.cases.mjs"], afterFiles: ["merged-lossy.cases.mjs"], census: r.census }), /Missing after the merge:\n\n- merge-a\.cases\.mjs :: a > two/)
})

// ---- guard ------------------------------------------------------------------

test("guardVerdict: covered, not covered, unresolved on a timeout or a red baseline, vacuous when the candidate catches nothing", () => {
  const green = { candidate: "pass", keepers: "pass" }
  const v = (seeds, baseline = green) => guardVerdict({ baseline, seeds })
  assert.equal(v([{ seed: "s", candidate: "caught", keepers: "caught" }]).exitCode, 0)
  const missed = v([{ seed: "s", candidate: "caught", keepers: "pass" }])
  assert.equal(missed.verdict, "not-covered")
  assert.equal(missed.exitCode, 1)
  assert.equal(v([{ seed: "s", candidate: "caught", keepers: "caught" }], { candidate: "caught", keepers: "pass" }).verdict, "unresolved", "a red baseline proves nothing")
  // A keeper that hangs on the seed did not catch it; neither is a candidate timeout a catch.
  const hang = v([{ seed: "s", candidate: "caught", keepers: "timeout" }])
  assert.equal(hang.verdict, "unresolved")
  assert.equal(hang.exitCode, 2)
  assert.equal(v([{ seed: "s", candidate: "timeout", keepers: "pass" }]).verdict, "unresolved")
  // No seed the candidate catches: the proof is empty.
  const vacuous = v([{ seed: "s", candidate: "pass", keepers: "pass" }])
  assert.equal(vacuous.verdict, "vacuous")
  assert.equal(vacuous.exitCode, 2)
  assert.deepEqual(vacuous.uncaught, ["s"])
  assert.match(renderGuard({ candidate: "c", keepers: ["k"], result: vacuous }), /VACUOUS/)
})

async function guard(seedNames) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "test-dedup-guard-fixture-"))
  cpSync(fixture, workspace, { recursive: true })
  try {
    return await proveGuard({
      workspace,
      makeRunner: (root) => createNodeTestRunner({ fixtureDir: root }),
      candidate: "guard-candidate.cases.mjs",
      keepers: ["guard-keeper.cases.mjs"],
      seeds: seedNames.map((s) => path.join(workspace, "seeds", s)),
    })
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

test("guard, end to end: every seeded violation the candidate catches, the keeper catches → covered", async () => {
  const r = await guard(["max.patch"])
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.exitCode, 0)
})

test("guard, end to end: seeds the candidate never catches → vacuous (exit 2), never covered", async () => {
  const r = await guard(["extra.patch"])
  assert.equal(r.verdict, "vacuous", JSON.stringify(r))
  assert.equal(r.exitCode, 2)
})

test("guard, end to end: a seeded violation only the candidate catches → not covered, naming the seed", async () => {
  const r = await guard(["max.patch", "names.patch"])
  assert.equal(r.ok, false)
  assert.deepEqual(r.rows.filter((row) => !row.ok).map((row) => row.seed), ["names.patch"])
})

// ---- review probes (PR #2302): each produced a false PROVEN ------------------

test("remove, probe: an assertion that lives only in a before() hook is the candidate's kill → NOT proven", async () => {
  // node reports the hooked test as cancelled; the first harness ignored it.
  const r = await removal("price-hook.cases.mjs", ["price-discount.cases.mjs"])
  assert.equal(r.verdict, "not-proven", JSON.stringify(r.unique.map((m) => m.label)))
  assert.ok(r.unique.some((m) => m.label === "price.mjs:3:24 return `0` → `undefined`"), "the hook's own assertion is what the keeper lacks")
})

test("remove, probe: a same-file keeper that fails only after the candidate ran gets no credit → NOT proven", async () => {
  const runner = await createNodeTestRunner({ fixtureDir: fixture })
  try {
    const r = await proveRemoval({ runner, candidate: "names.cases.mjs#rejects empty", keepers: ["names.cases.mjs"], sites: namesSites, readSource })
    assert.equal(r.verdict, "not-proven")
    assert.ok(r.unique.some((m) => m.label === "names.mjs:6:19 compare `>` → `<=`"), r.unique.map((m) => m.label).join("\n"))
  } finally {
    await runner.close()
  }
})

test("remove: keepers that fail without the candidate are refused (they depend on it)", async () => {
  const runner = await createNodeTestRunner({ fixtureDir: fixture })
  try {
    // Every run without the candidate is red: the proof would credit the keepers with every kill.
    const leaky = { ...runner, run: async (files, o) => {
      const r = await runner.run(files, o)
      return (o?.exclude?.length ?? 0) > 0 ? { ...r, tests: r.tests.map((t) => ({ ...t, state: "failed" })) } : r
    } }
    await assert.rejects(proveRemoval({ runner: leaky, candidate: "price.cases.mjs#an empty order is free", keepers: ["price.cases.mjs"], sites, readSource }), /without the candidate/)
  } finally {
    await runner.close()
  }
})

test("remove: a keeper kill that does not repeat, or is only a timeout, leaves the mutant unresolved", async () => {
  const runner = await createNodeTestRunner({ fixtureDir: fixture })
  try {
    const target = sites.find((s) => s.operator === "return" && s.line === 3)
    const make = (mode) => {
      let keeperRuns = 0
      return { ...runner, run: async (files, o) => {
        const r = await runner.run(files, o)
        if ((o?.overlay?.size ?? 0) === 0 || !files.includes("price-more.cases.mjs") || o.overlay.get("price.mjs") !== applySite(readSource("price.mjs"), target)) return r
        keeperRuns++
        if (mode === "flaky" && keeperRuns > 1) return { ...r, tests: r.tests.map((t) => ({ ...t, state: "passed", hookFailed: false })) }
        if (mode === "timeout") return { ...r, tests: r.tests.map((t) => (t.state === "failed" ? { ...t, timedOut: true } : t)) }
        return r
      } }
    }
    for (const [mode, outcome] of [["flaky", "flaky"], ["timeout", "keeper-timeout"]]) {
      const r = await proveRemoval({ runner: make(mode), candidate: "price.cases.mjs#an empty order is free", keepers: ["price.cases.mjs", "price-more.cases.mjs"], sites: [target], readSource })
      assert.equal(r.verdict, "unresolved", mode)
      assert.deepEqual(r.unresolved.map((m) => m.outcome), [outcome], mode)
    }
  } finally {
    await runner.close()
  }
})

test("detected / selectionProblem: hook failures and module failures kill the selected tests; a narrowed run must run what it names", () => {
  const run = { tests: [
    { id: "a#x", file: "a", name: "x", state: "skipped", hookFailed: true, timedOut: false },
    { id: "a#y", file: "a", name: "y", state: "passed", hookFailed: true, timedOut: false },
    { id: "a#z", file: "a", name: "z", state: "failed", hookFailed: false, timedOut: true },
    { id: "b#<module>", file: "b", name: "<module>", state: "failed", hookFailed: true },
  ] }
  const d = detected(run, ["a#x", "a#y", "a#z", "b#w"])
  assert.deepEqual([...d.killed].sort(), ["a#x", "a#y", "a#z", "b#w"])
  assert.deepEqual([...d.timeoutOnly], ["a#z"])
  assert.equal(selectionProblem(run, ["a#x", "a#y"], ["a#z"]), "a#z ran although it was left out")
  assert.equal(selectionProblem(run, ["a#q"], []), "a#q did not run")
  assert.equal(selectionProblem({ tests: [{ id: "a#x", file: "a", name: "x", state: "skipped", hookFailed: false }] }, ["a#x"], []), "a#x was skipped")
  assert.equal(selectionProblem(run, ["a#x", "a#y", "a#z", "b#w"], []), null)
})

test("namePattern: exact full names per file, joined by spaces as the runners match them", () => {
  const ids = ["f.test.ts#a > b", "f.test.ts#c", "g.test.ts#a > b"]
  const only = namePattern("f.test.ts", { only: ids })
  assert.ok(only.test("a b") && only.test("c") && !only.test("a b c") && !only.test("x c"))
  const skip = namePattern("f.test.ts", { exclude: ["f.test.ts#a > b"] })
  assert.ok(!skip.test("a b") && skip.test("a b c") && skip.test("c"))
  assert.equal(namePattern("h.test.ts", { exclude: ids }), undefined)
  assert.throws(() => namePattern("f.test.ts", { only: ids, exclude: ids }), /not both/)
})

test("strykerMatrix: no coveredBy stays unresolved; an unknown or missing killer is unresolved; the report must say bail was off", () => {
  const report = {
    config: { disableBail: true, coverageAnalysis: "perTest" },
    testFiles: { "a.test.ts": { tests: [{ id: "0", name: "keeps" }, { id: "1", name: "candidate" }] } },
    files: { "a.ts": { mutants: [
      { id: "m0", mutatorName: "X", status: "Timeout", location: { start: { line: 1, column: 1 } } },
      { id: "m1", mutatorName: "X", status: "Killed", killedBy: ["1", "9"], coveredBy: ["0", "1"], location: { start: { line: 2, column: 1 } } },
      { id: "m2", mutatorName: "X", status: "Killed", killedBy: [], coveredBy: ["0", "1"], location: { start: { line: 3, column: 1 } } },
    ] } },
  }
  const { tests, mutants } = strykerMatrix(report, "")
  assert.equal(mutants[0].coveredBy, undefined, "no coverage data is not 'covered by nobody'")
  assert.deepEqual(mutants.map((m) => m.outcome), ["timeout", "error", "error"])
  const r = killVerdict({ mutants, candidateIds: [tests[1].id], keeperIds: [tests[0].id] })
  assert.equal(r.verdict, "unresolved")
  assert.equal(r.unresolved.length, 3)
  assert.equal(strykerReportProblem(report), null)
  assert.match(strykerReportProblem({ ...report, config: { ...report.config, disableBail: false } }), /disableBail/)
  assert.match(strykerReportProblem({ ...report, config: { ...report.config, coverageAnalysis: "all" } }), /perTest/)
  assert.match(strykerReportProblem({ files: {} }), /no `config`/)
})

test("censusDiff: a test under a throwing hook is a failure, not a pass", () => {
  const before = [{ file: "a.test.ts", name: "x", state: "passed" }]
  const r = censusDiff({ before, after: [{ file: "a.test.ts", name: "x", state: "passed", hookFailed: true }] })
  assert.equal(r.ok, false)
  assert.deepEqual(r.failed, ["a.test.ts#x"])
})

test("coverageDiff: two branch arms on one line are two keys", () => {
  const before = new Map([["s.ts", new Set(["statement 3:1#0", "branch 3:9 cond-expr[0]#0", "branch 3:15 cond-expr[1]#0"])]])
  const after = new Map([["s.ts", new Set(["statement 3:1#0", "branch 3:9 cond-expr[0]#0"])]])
  const d = coverageDiff(before, after)
  assert.equal(d.ok, false)
  assert.deepEqual(d.rows[0].lost, ["branch 3:15 cond-expr[1]#0"])
})

test("staticsDiff: environment, mocks, shared worker, hooks, watches, size, assertions and bodies", () => {
  const f = (file, over = {}) => ({ file, env: "", mocks: ["vi.mock(\"./x\")"], hooks: [], assertions: ["expect(a).toBe(1)"], bodies: ["{ expect(a).toBe(1); }"], watches: [], lines: 10, ...over })
  const before = [f("x/a.test.ts"), f("x/b.test.ts", { assertions: ["expect(b).toBe(2)"], bodies: ["{ expect(b).toBe(2); }"], watches: ["docs/**"], hooks: ["beforeEach(() => reset())"] })]
  const merged = f("x/ab.test.ts", { assertions: ["expect(a).toBe(1)", "expect(b).toBe(2)"], bodies: ["{ expect(a).toBe(1); }", "{ expect(b).toBe(2); }"], watches: ["docs/**"], hooks: ["beforeEach(() => reset())", "afterEach(() => vi.restoreAllMocks())"] })
  const ok = staticsDiff({ before, after: [merged] })
  assert.equal(ok.ok, true, JSON.stringify(ok.rows.filter((r) => !r.ok)))
  const failing = (after, extra = {}) => staticsDiff({ before, after: [after], ...extra }).rows.filter((r) => !r.ok).map((r) => r.check.split(" (")[0])
  assert.deepEqual(failing({ ...merged, assertions: ["expect(a).toBe(1)"] }), ["Same assertions"], "a dropped expect")
  assert.deepEqual(failing({ ...merged, env: "jsdom" }), ["Same `@vitest-environment`"])
  assert.deepEqual(failing({ ...merged, mocks: [] }), ["Same vi.mock set and factories in every file"])
  assert.deepEqual(failing({ ...merged, hooks: [] }), ["Every hook of the originals kept"])
  assert.deepEqual(failing({ ...merged, watches: [] }), ["`@test-watches` / `@test-always`: the union kept"])
  assert.deepEqual(failing({ ...merged, lines: 801 }), ["Merged file(s) at most 800 lines"])
  assert.deepEqual(failing({ ...merged, bodies: ["{ expect(a).toBe(1); }"] }), ["Same test bodies"])
  assert.deepEqual(failing(merged, { sharedWorker: new Set(["x/a.test.ts"]) }), ["No shared-worker file"])
})

test("merge: a timed-out or erroring run is never equal", async () => {
  const fake = (after) => ({ run: async (files) => (files.includes("a.test.ts") ? { tests: [{ id: "a.test.ts#x", file: "a.test.ts", name: "x", state: "passed" }], timedOut: false, unhandledErrors: 0 } : after) })
  const same = [{ id: "b.test.ts#x", file: "b.test.ts", name: "x", state: "passed" }]
  const timedOut = await proveMerge({ runner: fake({ tests: [], timedOut: true, unhandledErrors: 0 }), before: ["a.test.ts"], after: ["b.test.ts"] })
  assert.equal(timedOut.verdict, "unresolved")
  assert.equal(timedOut.exitCode, 2)
  const unhandled = await proveMerge({ runner: fake({ tests: same, timedOut: false, unhandledErrors: 1 }), before: ["a.test.ts"], after: ["b.test.ts"] })
  assert.equal(unhandled.verdict, "unresolved")
  assert.match(renderMerge({ beforeFiles: ["a.test.ts"], afterFiles: ["b.test.ts"], census: unhandled.census, problems: unhandled.problems, verdict: unhandled.verdict }), /UNRESOLVED[\s\S]*unhandled error/)
  assert.equal((await proveMerge({ runner: fake({ tests: same, timedOut: false, unhandledErrors: 0 }), before: ["a.test.ts"], after: ["b.test.ts"] })).verdict, "equal")
})

test("packagesTouched: a seed under packages/<x>/ (not dist/) names the package to rebuild", () => {
  const patch = "--- a/packages/shared/src/a.ts\n+++ b/packages/shared/src/a.ts\n--- a/backend/x.ts\n+++ b/backend/x.ts\n+++ b/packages/prompts/dist/i.js\n"
  assert.deepEqual(packagesTouched(patch), ["packages/shared"])
})

// ---- the mutator itself (needs the repo's typescript) ------------------------

function typescriptOrSkip(t) {
  try {
    return createRequire(path.join(repoRoot, "package.json"))("typescript")
  } catch {
    t.skip("typescript is not installed (this job runs without npm ci); covered wherever node_modules exists")
    return null
  }
}

test("mutate, probe: concise arrows, arithmetic, unary minus and optional chaining are mutation sites", async (t) => {
  const ts = typescriptOrSkip(t)
  if (!ts) return
  const { mutationSites } = await import("../test-dedup/mutate.mjs")
  const ops = (src) => mutationSites(ts, src, "probe.ts").map((s) => `${s.operator} ${s.original} → ${s.replacement}`)
  assert.deepEqual(ops("export const sum = (a, b) => a + b\n"), ["arrow a + b → undefined", "arithmetic + → -"])
  assert.deepEqual(ops("export const pick = (o) => o?.v.map((n) => -n)\n"), [
    "arrow o?.v.map((n) => -n) → undefined", "optional ?. → .", "arrow -n → undefined", "unary -n → (n)",
  ])
  assert.deepEqual(ops("x ??= a ?? b\n"), ["assign ??= → &&=", "logical a ?? b → (a)", "logical a ?? b → (b)", "logical ?? → &&"])
  assert.deepEqual(ops("[a, b] = [b, a]\n"), ["array [b, a] → []"], "a destructuring target is not a literal")
  assert.deepEqual(ops("const m = Math.max(xs.filter(f).length, 0)\n"), [
    "call Math.max(xs.filter(f).length, 0) → undefined", "method max → min", "call xs.filter(f) → undefined", "method xs.filter(f) → xs", "literal 0 → 1",
  ])
})

test("mutate: every site of the operator fixtures still parses (a syntax error would kill everything)", async (t) => {
  const ts = typescriptOrSkip(t)
  if (!ts) return
  const { mutationSites, parseErrors } = await import("../test-dedup/mutate.mjs")
  const files = ["operators/all.ts", "operators/view.tsx", "price.mjs", "names.mjs", "vitest/math.mjs", "vitest/hooks.mjs", "vitest/names.mjs"]
  const seen = new Set()
  for (const file of files) {
    const src = readSource(file)
    assert.deepEqual(parseErrors(ts, src, file), [], `${file} itself parses`)
    for (const site of mutationSites(ts, src, file)) {
      seen.add(site.operator)
      assert.deepEqual(parseErrors(ts, applySite(src, site), file), [], describeSite(site))
    }
  }
  assert.deepEqual([...seen].sort(), ["arithmetic", "array", "arrow", "assign", "block", "call", "compare", "literal", "logical", "method", "negate", "object", "optional", "return", "unary", "update"])
})

test("mutate: sites-names.json is what the mutator computes today", async (t) => {
  const ts = typescriptOrSkip(t)
  if (!ts) return
  const { mutationSites } = await import("../test-dedup/mutate.mjs")
  assert.deepEqual(mutationSites(ts, readSource("names.mjs"), "names.mjs"), namesSites,
    "Regenerate: node tools/test-dedup/mutate.mjs tools/__tests__/fixtures/test-dedup/names.mjs --as names.mjs > tools/__tests__/fixtures/test-dedup/sites-names.json")
})

test("siteCovered: a statement that ends with a null column (v8 → istanbul) runs to the end of its line; the later-starting one is inner", async () => {
  const { siteCovered } = await import("../test-dedup/runners.mjs")
  // `if (strict) return n > 0 ? "pos" : "non-pos"` — the `if` ran, its `return` did not.
  const spans = new Map([["s.mjs", [
    { start: { line: 10, column: 2 }, end: { line: 10, column: null }, covered: true },
    { start: { line: 10, column: 14 }, end: { line: 10, column: null }, covered: false },
    { start: { line: 9, column: 0 }, end: { line: 12, column: 1 }, covered: true },
  ]]])
  assert.equal(siteCovered({ file: "s.mjs", line: 10, column: 24 }, spans), false, "inside the return that never ran")
  assert.equal(siteCovered({ file: "s.mjs", line: 10, column: 7 }, spans), true, "the if's own condition ran")
  assert.equal(siteCovered({ file: "s.mjs", line: 11, column: 3 }, spans), true)
  assert.equal(siteCovered({ file: "t.mjs", line: 1, column: 1 }, spans), true, "no coverage data: kept")
})

test("ci.yml: the Diff Gate runs the Test De-dup Harness job on exactly the Vitest file's @test-watches", async () => {
  const { parseAnnotations } = await import("../test-select/annotations.mjs")
  const ci = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8")
  const line = ci.split("\n").find((l) => l.includes("# test-dedup inputs"))
  assert.ok(line, "ci.yml's Diff Gate has the `# test-dedup inputs` case line")
  const patterns = line.trim().split(")")[0].split("|").sort()
  const watches = parseAnnotations(readFileSync(path.join(here, "test-dedup-equivalence-vitest.test.mjs"), "utf8")).watches
  assert.deepEqual(patterns, watches.map((g) => g.replace(/\*\*/g, "*")).sort())
  assert.match(ci, /TEST_DEDUP_REQUIRE_VITEST: "1"\n\s+run: node --test tools\/__tests__\/test-dedup-equivalence\.test\.mjs tools\/__tests__\/test-dedup-equivalence-vitest\.test\.mjs/)
})

test("strangers / selectionProblem: a test the baseline never had (a renamed one) is flagged, never silently ignored", () => {
  const run = { tests: [
    { id: "a#price a", file: "a", name: "price a", state: "skipped", hookFailed: false },
    { id: "a#price ", file: "a", name: "price ", state: "failed", hookFailed: false },
    { id: "a#one id", file: "a", name: "one id", state: "passed", hookFailed: false },
    { id: "a#later", file: "a", name: "later", state: "skipped", hookFailed: false },
  ] }
  assert.deepEqual(strangers(run, ["a"], new Set(["a#price a", "a#one id", "a#later"])).map((t) => t.id), ["a#price "])
  assert.equal(selectionProblem(run, ["a#one id"], ["a#price a"]), "a#price  ran but is no test the run named (renamed or new)")
  const clean = { tests: run.tests.filter((t) => t.id !== "a#price ") }
  assert.equal(selectionProblem(clean, ["a#one id"], ["a#price a"]), null, "a skipped test outside the run's names is fine")
})

test("collectionChanged / selectionProblem: one id on more tests than at baseline (a test renamed onto a sibling's name) is flagged", () => {
  const t = (name, state = "passed") => ({ id: `e#${name}`, file: "e", name, state, hookFailed: false })
  const baselineCounts = idCounts([t("n=0"), t("n=1"), t("keep")])
  const renamed = { tests: [t("n=1", "failed"), t("n=1"), t("keep")] }
  assert.equal(collectionChanged(renamed, ["e"], baselineCounts), true)
  assert.equal(collectionChanged({ tests: [t("n=0"), t("n=1"), t("keep")] }, ["e"], baselineCounts), false)
  assert.equal(selectionProblem(renamed, ["e#n=1", "e#keep"], ["e#n=0"], baselineCounts), "e#n=1 names 2 tests, 1 at baseline (a test renamed onto it)")
  assert.equal(selectionProblem({ tests: [t("n=0", "skipped"), t("n=1"), t("keep")] }, ["e#n=1", "e#keep"], ["e#n=0"], baselineCounts), null)
})
