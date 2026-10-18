// tools/__tests__/test-select-shadow-report.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { expectedFromJobs, mergeShardEntries, aggregateShadow, resolveBase, shadowExpected, baseFailures, baseFromCheckoutLog, withRetry, classifyFullReason } from "../test-select/shadow-report.mjs"

const run = (url, frontend, backend) => ({ url, projects: { ...(frontend && { frontend }), ...(backend && { backend }) } })

test("shadow report: every miss is listed with its file and run; shares are per project medians", () => {
  const out = aggregateShadow([
    run("u1", { shadow: { wouldRun: "affected", selected: 10, misses: ["src/a.test.ts"] }, selection: { total: 100 } },
      { shadow: { wouldRun: "none", selected: 0, misses: [] }, selection: { total: 50 } }),
    run("u2", { shadow: { wouldRun: "full", selected: 0, misses: [] }, selection: { total: 100 } }, null),
    run("u3", { shadow: { wouldRun: "affected", selected: 30, misses: [] }, selection: { total: 100 } },
      { shadow: { wouldRun: "affected", selected: 5, misses: ["src/b.test.ts", "src/c.test.ts"] }, selection: { total: 50 } }),
  ])
  assert.equal(out.runsChecked, 3)
  assert.deepEqual(out.misses, [
    { project: "frontend", file: "src/a.test.ts", url: "u1" },
    { project: "backend", file: "src/b.test.ts", url: "u3" },
    { project: "backend", file: "src/c.test.ts", url: "u3" },
  ])
  assert.equal(out.medianShare.frontend, 0.3) // 0.1, 1, 0.3
  assert.equal(out.medianShare.backend, 0.05) // 0, 0.1 → mean of the middle two
})

test("shadow report: a check that errored or a selection with no total is counted, never a share", () => {
  const out = aggregateShadow([
    run("u1", { shadow: { wouldRun: "affected", selected: 3, misses: [], error: "ENOENT" }, selection: { total: 10 } }, null),
    run("u2", { shadow: { wouldRun: "affected", selected: 3, misses: [] }, selection: null }, null),
  ])
  assert.equal(out.runsChecked, 2)
  assert.deepEqual(out.errors, [{ project: "frontend", url: "u1", error: "ENOENT" }])
  assert.equal(out.medianShare.frontend, null)
  assert.equal(out.medianShare.backend, null)
})

test("shadow report: an unattributed failure is counted apart and listed — it blocks a clean record", () => {
  const out = aggregateShadow([
    run("u1", { shadow: { wouldRun: "affected", selected: 3, misses: [], failed: [], unattributed: true }, selection: { total: 10 } }, null),
    run("u2", null, { shadow: { wouldRun: "none", selected: 0, misses: [], failed: [], error: "ENOENT", unattributed: true }, selection: { total: 10 } }),
  ])
  assert.deepEqual(out.unattributed, [{ project: "frontend", url: "u1" }, { project: "backend", url: "u2" }])
  assert.deepEqual(out.misses, [])
  assert.equal(out.clean, false)
})

test("shadow report: a shadow JSON that did not parse, or is missing from its artifact, is an error — never skipped", () => {
  const out = aggregateShadow([
    run("u1", { error: "shadow-frontend.json: Unexpected token" }, null),
    run("u2", null, { shadow: null, selection: { total: 5 } }),
  ])
  assert.deepEqual(out.errors, [
    { project: "frontend", url: "u1", error: "shadow-frontend.json: Unexpected token" },
    { project: "backend", url: "u2", error: "shadow-backend.json missing from the artifact" },
  ])
  assert.equal(out.clean, false)
})

test("shadow report: clean only when runs were checked and nothing missed, errored or went unattributed", () => {
  const ok = run("u1", { shadow: { wouldRun: "full", selected: 0, misses: [] }, selection: { total: 1 } }, null)
  assert.equal(aggregateShadow([ok]).clean, true)
  assert.equal(aggregateShadow([]).clean, false)
})

test("shadow report: a selector that crashed is counted apart and blocks a clean record", () => {
  const out = aggregateShadow([run("u1", { shadow: { project: "frontend", error: "selector crashed: boom", crashed: true }, selection: null }, null)])
  assert.deepEqual(out.crashed, [{ project: "frontend", url: "u1", error: "selector crashed: boom" }])
  assert.deepEqual(out.errors, [])
  assert.equal(out.clean, false)
})

test("shadow report: a project whose test job ran but left no shadow data is listed as missing — and blocks clean", () => {
  const ok = { shadow: { wouldRun: "full", selected: 0, misses: [] }, selection: { total: 1 } }
  const out = aggregateShadow([
    { url: "u1", expected: ["frontend", "backend"], projects: { frontend: ok } },
    { url: "u2", expected: ["backend"], projects: {} },
    { url: "u3", expected: ["frontend"], projects: { frontend: ok } },
  ])
  assert.deepEqual(out.missing, [{ project: "backend", url: "u1" }, { project: "backend", url: "u2" }])
  assert.equal(out.clean, false)
  assert.equal(aggregateShadow([{ url: "u3", expected: ["frontend"], projects: { frontend: ok } }]).clean, true)
})

test("shadow report: an unreadable selection costs the share, not the shadow result", () => {
  const out = aggregateShadow([run("u1", { shadow: { wouldRun: "affected", selected: 2, misses: ["src/a.test.ts"] }, selection: null, selectionError: "selection-frontend.json: Unexpected token" }, null)])
  assert.deepEqual(out.misses, [{ project: "frontend", file: "src/a.test.ts", url: "u1" }])
  assert.deepEqual(out.selectionErrors, [{ project: "frontend", url: "u1", error: "selection-frontend.json: Unexpected token" }])
  assert.equal(out.medianShare.frontend, null)
})

test("shadow report: no runs → nothing checked", () => {
  assert.deepEqual(aggregateShadow([]), { runsChecked: 0, misses: [], inherited: [], unattributed: [], crashed: [], missing: [], errors: [], selectionErrors: [], clean: false, registry: { checked: 0, misses: [], clean: false }, medianShare: { frontend: null, backend: null },
    narrowed: { medianShare: { frontend: null, backend: null }, runs: { frontend: 0, backend: 0 } }, full: { runs: 0, byCause: [] } })
})

test("shadow report: registry-rule misses are reported apart and never decide clean", () => {
  const run = (registryMisses, registryDiffers = true) => ({ url: "u", expected: ["frontend"], projects: { frontend: { shadow: { wouldRun: "affected", selected: 1, failed: ["a"], misses: [], registryRule: "affected", registryMisses, registryDiffers }, selection: { total: 10 } } } })
  const missed = aggregateShadow([run(["frontend/src/a.test.ts"])])
  assert.equal(missed.clean, true, "the main selector's record is untouched")
  assert.deepEqual(missed.registry, { checked: 1, misses: [{ project: "frontend", file: "frontend/src/a.test.ts", url: "u" }], clean: false })
  assert.equal(aggregateShadow([run([])]).registry.clean, true)
  assert.deepEqual(aggregateShadow([run([], false)]).registry, { checked: 0, misses: [], clean: false }, "a run where the two selections are equal checks nothing")
  const affected = aggregateShadow([], [{ project: "backend", url: "v", check: { registryDiffers: true, registryMisses: ["backend/src/x.test.ts"] } }, { project: "backend", url: "w", check: { registryDiffers: false, registryMisses: [] } }])
  assert.deepEqual(affected.registry, { checked: 1, misses: [{ project: "backend", file: "backend/src/x.test.ts", url: "v" }], clean: false }, "affected-mode registry checks are collected too")
  const shards = aggregateShadow([], [1, 2, 3].map((n) => ({ project: "frontend", url: "s", check: { registryDiffers: true, registryMisses: n === 2 ? ["a"] : [] } })))
  assert.deepEqual(shards.registry, { checked: 1, misses: [{ project: "frontend", file: "a", url: "s" }], clean: false }, "a run's shards count once")
  const merged = mergeShardEntries([{ shard: 1, shadow: { wouldRun: "affected", misses: [], registryMisses: ["x"] } }, { shard: 2, shadow: { wouldRun: "affected", misses: [], registryMisses: ["y"] } }], [1, 2])
  assert.deepEqual(merged.shadow.registryMisses, ["x", "y"])
  assert.equal(merged.shadow.registryDiffers, false)
})

// GitHub fills a run's pull_requests only while the PR is open (live: run
// 38439712814 of PR #2168, merged into dev, lists none).
test("base: an open PR's base comes from the run itself", () => {
  assert.equal(resolveBase({ listedBases: ["dev"], headSha: "h", pulls: undefined }), "dev")
  assert.equal(resolveBase({ listedBases: ["main"], headSha: "h", pulls: undefined }), "other")
})

test("base: a merged PR is found through the commit's pulls — its head sha first, else any PR into dev", () => {
  const pulls = [{ base: { ref: "main" }, head: { sha: "other" } }, { base: { ref: "dev" }, head: { sha: "h" } }]
  assert.equal(resolveBase({ listedBases: [], headSha: "h", pulls }), "dev")
  assert.equal(resolveBase({ listedBases: [], headSha: "h", pulls: [{ base: { ref: "main" }, head: { sha: "h" } }, { base: { ref: "dev" }, head: { sha: "x" } }] }), "other")
  assert.equal(resolveBase({ listedBases: [], headSha: "h", pulls: [{ base: { ref: "dev" }, head: { sha: "x" } }] }), "dev")
})

// Run 39051029824 (PR #2303, dev → main, merged): the run lists no PR, and the
// commit's pulls hold only #2297, the feature PR merged into dev at that sha.
test("base: a run whose head is this repository's dev branch is the release PR, never a PR into dev", () => {
  const pulls = [{ number: 2297, base: { ref: "dev" }, head: { sha: "feature-head" } }]
  assert.equal(resolveBase({ listedBases: [], headSha: "48f05", pulls, headBranch: "dev", sameRepo: true }), "other")
  assert.equal(resolveBase({ listedBases: [], headSha: "48f05", pulls: null, headBranch: "dev", sameRepo: true }), "other")
  // a fork's branch named dev proves nothing; a listed base still decides first
  assert.equal(resolveBase({ listedBases: [], headSha: "48f05", pulls, headBranch: "dev", sameRepo: false }), "dev")
  assert.equal(resolveBase({ listedBases: ["dev"], headSha: "48f05", pulls, headBranch: "dev", sameRepo: true }), "dev")
  assert.equal(resolveBase({ listedBases: [], headSha: "48f05", pulls, headBranch: "feat/x", sameRepo: true }), "dev")
})

test("base: no PR found, or the lookup failed → unknown", () => {
  assert.equal(resolveBase({ listedBases: [], headSha: "h", pulls: [] }), "unknown")
  assert.equal(resolveBase({ listedBases: [], headSha: "h", pulls: [{ base: { ref: "main" }, head: { sha: "x" } }] }), "unknown")
  assert.equal(resolveBase({ listedBases: [], headSha: "h", pulls: null }), "unknown")
})

test("a run with no shadow artifact is checked unless it is provably not a PR into dev (unknown fails closed)", () => {
  assert.equal(shadowExpected({ base: "dev", hasArtifacts: false, expected: ["frontend"] }), true)
  assert.equal(shadowExpected({ base: "unknown", hasArtifacts: false, expected: ["backend"] }), true)
  assert.equal(shadowExpected({ base: "other", hasArtifacts: false, expected: ["frontend", "backend"] }), false)
  // no test job ran (Diff Gate skipped both, or the run was cancelled): nothing to miss
  assert.equal(shadowExpected({ base: "unknown", hasArtifacts: false, expected: [] }), false)
  // a run with shadow artifacts is always checked
  assert.equal(shadowExpected({ base: "other", hasArtifacts: true, expected: [] }), true)
})

// Sharded test jobs (decided 2026-10-14): one artifact per shard, merged per project.
test("shards: misses and failures are the union; any unattributed shard makes the project unattributed", () => {
  const sel = { total: 100 }
  const sh = (o) => ({ project: "frontend", wouldRun: "affected", selected: 10, failed: [], misses: [], ...o })
  const e = mergeShardEntries([
    { shard: 1, shadow: sh({ failed: ["a.test.ts"], misses: ["a.test.ts"] }), selection: sel },
    { shard: 2, shadow: sh({}), selection: sel },
    { shard: 3, shadow: sh({ failed: ["b.test.ts"], misses: [], unattributed: true }), selection: sel },
  ], [1, 2, 3])
  assert.deepEqual(e.shadow.misses, ["a.test.ts"])
  assert.deepEqual(e.shadow.failed, ["a.test.ts", "b.test.ts"])
  assert.equal(e.shadow.unattributed, true)
  assert.equal(e.selection, sel)
  const report = aggregateShadow([{ url: "u", expected: ["frontend"], projects: { frontend: e } }])
  assert.equal(report.misses.length, 1)
  assert.equal(report.unattributed.length, 1)
  assert.equal(report.clean, false)
})

test("shards: a shard that finished without data, or an unreadable shard, is an error — never a smaller suite", () => {
  const sh = { project: "backend", wouldRun: "full", selected: 0, failed: [], misses: [] }
  const lost = mergeShardEntries([{ shard: 1, shadow: sh }, { shard: 2, shadow: sh }], [1, 2, 3, 4])
  assert.match(lost.error, /no shadow data from shard 3, 4/)
  const bad = mergeShardEntries([{ shard: 1, shadow: sh }, { shard: 2, error: "shadow-backend-2: bad json" }], [1, 2])
  assert.match(bad.error, /shadow-backend-2: bad json/)
  const empty = mergeShardEntries([{ shard: 1, shadow: null }], [1])
  assert.match(empty.error, /shard 1: shadow JSON missing/)
  for (const e of [lost, bad, empty]) {
    assert.equal(aggregateShadow([{ url: "u", expected: ["backend"], projects: { backend: e } }]).clean, false)
  }
})

// Runs 39070714645, 39053728041, 39059853548: a shard cancelled by a newer push
// still uploads its selection (the step is always()), without shadow JSON.
test("shards: a selection-only artifact from a shard that did not finish is dropped, never an error", () => {
  const sel = { mode: "full", files: [], total: 1450 }
  const sh = { project: "frontend", wouldRun: "full", selected: 0, failed: [], misses: [] }
  const e = mergeShardEntries([{ shard: 1, shadow: sh, selection: sel }, { shard: 2, shadow: sh, selection: sel }, { shard: 3, shadow: null, selection: sel }, { shard: 4, shadow: sh, selection: sel }], [1, 2, 4])
  assert.equal(e.error, undefined)
  const report = aggregateShadow([{ url: "u", expected: ["frontend"], projects: { frontend: e } }])
  assert.equal(report.errors.length, 0)
  assert.equal(report.clean, true)
  assert.equal(report.medianShare.frontend, 1)
  // every shard cancelled: no entry at all (the run's expected list decides "missing")
  assert.equal(mergeShardEntries([{ shard: 1, shadow: null, selection: sel }, { shard: 2, shadow: null, selection: sel }], []), null)
  // the dropped shard's selection still gives the share
  const affected = { project: "frontend", wouldRun: "affected", selected: 10, failed: [], misses: [] }
  assert.deepEqual(mergeShardEntries([{ shard: 1, shadow: null, selection: { total: 100 } }, { shard: 2, shadow: affected }], [2]).selection, { total: 100 })
  // what stays an error: an unreadable artifact from any shard, and a shard that finished without data
  assert.match(mergeShardEntries([{ shard: 1, error: "shadow-frontend-1: bad json" }], []).error, /bad json/)
  assert.match(mergeShardEntries([{ shard: 1, shadow: sh }, { shard: 2, shadow: null }], [1, 2]).error, /shard 2: shadow JSON missing/)
  // a cancelled shard that did write its shadow data still counts
  const miss = mergeShardEntries([{ shard: 1, shadow: { ...affected, failed: ["a.test.ts"], misses: ["a.test.ts"] } }], [])
  assert.deepEqual(miss.shadow.misses, ["a.test.ts"])
})

test("shards: a crashed selector in any shard is the project's crash; disagreeing shards are an error", () => {
  const ok = { project: "frontend", wouldRun: "affected", selected: 3, failed: [], misses: [] }
  const crash = mergeShardEntries([{ shard: 1, shadow: ok }, { shard: 2, shadow: { project: "frontend", error: "selector crashed: boom", crashed: true } }], [1, 2])
  assert.equal(crash.shadow.crashed, true)
  assert.equal(aggregateShadow([{ url: "u", expected: ["frontend"], projects: { frontend: crash } }]).crashed.length, 1)
  const split = mergeShardEntries([{ shard: 1, shadow: ok }, { shard: 2, shadow: { ...ok, wouldRun: "full" } }], [1, 2])
  assert.match(split.error, /disagree/)
})

test("shards: an unsharded artifact from before sharding is read as it was", () => {
  const shadow = { project: "frontend", wouldRun: "none", selected: 0, failed: [], misses: [] }
  const e = mergeShardEntries([{ shard: null, shadow, selection: null }], [])
  assert.equal(e.error, undefined)
  assert.equal(e.shadow.wouldRun, "none")
})

test("shards: shadow data is expected from the shard jobs that finished, never from the fan-in check", () => {
  // the fan-in "Backend Tests" passes when the Diff Gate skipped every shard
  const { expected, expectedShards } = expectedFromJobs({
    "Frontend Tests": "failure", "Frontend Tests (1/4)": "success", "Frontend Tests (2/4)": "failure", "Frontend Tests (3/4)": "cancelled",
    "Backend Tests": "success", "Backend Tests (${{ matrix.shard }}/4)": "skipped",
  })
  assert.deepEqual(expected, ["frontend"])
  assert.deepEqual(expectedShards, { frontend: [1, 2], backend: [] })
  // a run from before sharding: the plain job decides
  assert.deepEqual(expectedFromJobs({ "Frontend Tests": "success", "Backend Tests": "skipped" }).expected, ["frontend"])
})

test("shards: an errored shard keeps the other shards' misses listed — and the project is not clean", () => {
  const sh = { project: "frontend", wouldRun: "affected", selected: 2, failed: ["a.test.ts"], misses: ["a.test.ts"] }
  const e = mergeShardEntries([{ shard: 1, shadow: sh }, { shard: 2, error: "shadow-frontend-2: bad json" }], [1, 2])
  assert.match(e.error, /bad json/)
  const report = aggregateShadow([{ url: "u", expected: ["frontend"], projects: { frontend: e } }])
  assert.equal(report.misses.length, 1)
  assert.equal(report.errors.length, 1)
  assert.equal(report.clean, false)
})

// Run 38902459956 (PR #2290, a packages/shared speaker-tracks change) was
// tested on 2caffe217 (#2288), which had broken library-render-label.test.ts on
// dev: its own post-merge run 38901166941 failed it, and again alone. The
// selector rightly skipped the file; the report called it a miss.
const LABEL = "src/routes/__tests__/library-render-label.test.ts"
const BASE = "2caffe217d20f26be49c638c692301b1eb5f324c"
const missRun = (bases) => ({
  url: "https://github.com/o/r/actions/runs/38902459956", expected: ["backend"],
  projects: { backend: { shadow: { wouldRun: "affected", selected: 1146, failed: [LABEL], misses: [LABEL] }, selection: { total: 2218 } } },
  ...(bases && { bases }),
})

test("inherited: a miss that failed again on the PR's base commit's own dev run is inherited — listed apart, not blocking clean", () => {
  const out = aggregateShadow([missRun({ backend: { sha: BASE, url: "https://github.com/o/r/actions/runs/38901166941", failed: [LABEL], flaky: [], unknown: [] } })])
  assert.deepEqual(out.misses, [])
  assert.deepEqual(out.inherited, [{ project: "backend", file: LABEL, url: "https://github.com/o/r/actions/runs/38902459956", base: BASE, baseUrl: "https://github.com/o/r/actions/runs/38901166941" }])
  assert.equal(out.clean, true)
})

test("inherited: without that proof the miss stays a miss — base not looked up, unknown, green, or only flaky/unlabelled there", () => {
  const url = "https://github.com/o/r/actions/runs/38901166941"
  for (const [bases, note] of [
    [null, undefined],
    [{ backend: { error: "the commit the PR was tested on could not be found" } }, /not checked: the commit/],
    [{ backend: { sha: BASE, error: "no CI run of it on dev" } }, /base 2caffe217 not checked: no CI run/],
    [{ backend: { sha: BASE, url, failed: [], flaky: [], unknown: [] } }, undefined],
    [{ backend: { sha: BASE, url, failed: ["src/other.test.ts"], flaky: [LABEL], unknown: [] } }, /labelled flaky/],
    [{ backend: { sha: BASE, url, failed: [], flaky: [], unknown: [LABEL] } }, /left no report/],
    [{ frontend: { sha: BASE, url, failed: [LABEL], flaky: [], unknown: [] } }, undefined], // another project's list
    [{ backend: { url, failed: [LABEL] } }, undefined], // no sha: not a proof
  ]) {
    const out = aggregateShadow([missRun(bases)])
    assert.equal(out.misses.length, 1, JSON.stringify(bases))
    assert.deepEqual(out.inherited, [])
    assert.equal(out.clean, false)
    if (note) assert.match(out.misses[0].baseNote, note)
    else assert.equal(out.misses[0].baseNote, undefined)
  }
})

test("base: read from the merge commit actions/checkout logs on a pull_request job", () => {
  const log = "2026-10-16T12:45:34.7556769Z HEAD is now at ef951ce Merge 6af8dd0d1beb15a4528ce6450027ea0b66691b25 into 2caffe217d20f26be49c638c692301b1eb5f324c\n"
  assert.equal(baseFromCheckoutLog(log), BASE)
  assert.equal(baseFromCheckoutLog("HEAD is now at 2caffe2 feat(library): deep link (#2288)"), null) // a push checkout
  assert.equal(baseFromCheckoutLog(undefined), null)
})

test("base failures: only a finished dev run's failed-file lists prove anything; every gap is an error", () => {
  const url = "https://github.com/o/r/actions/runs/1"
  const lists = { "failed-backend-1": { failed: [LABEL], flaky: [], unknown: [] }, "failed-backend-3": { failed: ["src/b.test.ts"], flaky: ["src/c.test.ts"], unknown: [] } }
  const readLists = (name) => { if (!lists[name]) throw new Error("no such artifact"); return lists[name] }
  const red = { url, status: "completed", conclusion: "failure", artifacts: ["ci-build-backend", "failed-backend-1", "failed-backend-3", "failed-frontend-2"] }
  assert.deepEqual(baseFailures({ sha: BASE, project: "backend", devRuns: [red], readLists }),
    { sha: BASE, url, failed: [LABEL, "src/b.test.ts"].sort(), flaky: ["src/c.test.ts"], unknown: [] })
  assert.deepEqual(baseFailures({ sha: BASE, project: "backend", devRuns: [{ url, status: "completed", conclusion: "success" }], readLists }),
    { sha: BASE, url, failed: [], flaky: [], unknown: [] })
  assert.match(baseFailures({ sha: BASE, project: "backend", devRuns: [], readLists }).error, /no CI run/)
  assert.match(baseFailures({ sha: BASE, project: "backend", devRuns: [{ url, status: "in_progress", conclusion: "" }], readLists }).error, /not finished/)
  assert.match(baseFailures({ sha: BASE, project: "backend", devRuns: [{ url, status: "completed", conclusion: "cancelled" }], readLists }).error, /ended cancelled/)
  assert.match(baseFailures({ sha: BASE, project: "backend", devRuns: [{ ...red, artifacts: ["failed-frontend-2"] }], readLists }).error, /no failed-backend list/)
  assert.match(baseFailures({ sha: BASE, project: "frontend", devRuns: [red], readLists }).error, /failed-frontend-2: no such artifact/)
})

test("shards: a shard job that failed before its Run tests step ran no test — no shadow data is expected from it", () => {
  // run 38786332886: the pinned-ffmpeg download failed on backend shards 2 and 3
  const conclusions = { "Backend Tests (1/4)": "success", "Backend Tests (2/4)": "failure", "Backend Tests (3/4)": "failure", "Backend Tests (4/4)": "success" }
  const steps = { "Backend Tests (1/4)": "success", "Backend Tests (2/4)": "skipped", "Backend Tests (3/4)": "skipped", "Backend Tests (4/4)": "success" }
  const { expected, expectedShards } = expectedFromJobs(conclusions, steps)
  assert.deepEqual(expected, ["backend"])
  assert.deepEqual(expectedShards.backend, [1, 4])
  const sh = { project: "backend", wouldRun: "affected", selected: 3, failed: [], misses: [] }
  assert.equal(mergeShardEntries([{ shard: 1, shadow: sh }, { shard: 4, shadow: sh }], expectedShards.backend).error, undefined)
  // a Run tests step that ran — failed, or cancelled midway (a timeout) — still owes its data; so does a job with no such step
  assert.deepEqual(expectedFromJobs(conclusions, { ...steps, "Backend Tests (2/4)": "failure", "Backend Tests (3/4)": "cancelled" }).expectedShards.backend, [1, 2, 3, 4])
  assert.deepEqual(expectedFromJobs(conclusions).expectedShards.backend, [1, 2, 3, 4])
  // every shard failed before its tests: nothing ran, nothing is expected
  assert.deepEqual(expectedFromJobs({ "Backend Tests (1/4)": "failure" }, { "Backend Tests (1/4)": "skipped" }).expected, [])
})

test("gh calls: a transient GitHub 5xx is retried, anything else throws at once", () => {
  const pauses = []
  const pause = (ms) => pauses.push(ms)
  let n = 0
  const flaky = () => { if (++n < 3) throw Object.assign(new Error("Command failed"), { stderr: "gh: Server Error (HTTP 502)\n" }); return "ok" }
  assert.equal(withRetry(flaky, { pause }), "ok")
  assert.deepEqual(pauses, [2000, 4000])
  n = 0
  assert.throws(() => withRetry(() => { n++; throw Object.assign(new Error("x"), { stderr: "gh: Not Found (HTTP 404)" }) }, { pause }), /x/)
  assert.equal(n, 1)
  n = 0
  assert.throws(() => withRetry(() => { n++; throw Object.assign(new Error("x"), { stderr: "HTTP 503" }) }, { pause, tries: 3 }))
  assert.equal(n, 3)
})

// decided 2026-10-18: what sent the full runs full, and the share among the runs that narrowed
test("full-run causes: the global trigger glob the named file matches on this branch, or the other kinds of full run", () => {
  // a manifest the selector checked for a version-only change, and one it did not (judged before 2026-10-18, or a local run)
  assert.deepEqual(classifyFullReason("packages/cli/package.json can affect every test — more than versions and workspace ranges changed"), { cause: "global trigger **/package.json", file: "packages/cli/package.json" })
  assert.deepEqual(classifyFullReason("packages/cli/package.json can affect every test"),
    { cause: "global trigger **/package.json (not checked for a version-only change — may be a release bump)", file: "packages/cli/package.json" })
  assert.equal(classifyFullReason("package-lock.json can affect every test").cause, "global trigger package-lock.json (not checked for a version-only change — may be a release bump)")
  // a non-manifest trigger never carries the mark
  assert.equal(classifyFullReason(".github/workflows/ci.yml can affect every test").cause, "global trigger .github/workflows/ci.yml")
  assert.deepEqual(classifyFullReason("tools/test-select/select.mjs can affect every test"), { cause: "global trigger tools/test-select/**/*.{mjs,js,ts}", file: "tools/test-select/select.mjs" })
  // narrowed since: the file names no trigger any more
  assert.deepEqual(classifyFullReason("tools/test-select/README.md can affect every test"), { cause: "no global trigger since 2026-10-18: tools/test-select/README.md", file: "tools/test-select/README.md" })
  assert.deepEqual(classifyFullReason("tools/__tests__/fixtures/test-dedup/vitest/vitest.config.mjs can affect every test").cause,
    "no global trigger since 2026-10-18: tools/__tests__/fixtures/test-dedup/vitest/vitest.config.mjs")
  assert.deepEqual(classifyFullReason("frontend/src/x.ts was removed or renamed — a test may still import it"), { cause: "a removed or renamed file", file: "frontend/src/x.ts" })
  assert.equal(classifyFullReason("frontend/src/__mocks__/x.ts is a manual mock — vi.mock() loads it without an import").cause, "a manual mock")
  assert.equal(classifyFullReason("frontend/src/__tests__/fixtures/a.json is test data read at run time — running everything").cause, "test data")
  assert.equal(classifyFullReason("the diff lists 2950 files — too many to see them all").cause, "a diff too large to list")
  assert.equal(classifyFullReason("selection engine could not decide (boom) — running everything").cause, "the selection engine could not decide")
  assert.equal(classifyFullReason(undefined).cause, "reason unknown (the selection could not be read)")
  assert.equal(classifyFullReason("something new").cause, "other: something new")
})

test("full-run breakdown: each run counted once per cause, project runs apart, example PRs; narrowed median leaves full runs out", () => {
  const full = (reason) => ({ shadow: { wouldRun: "full", selected: 0, misses: [] }, selection: { total: 100, reason } })
  const affected = (n) => ({ shadow: { wouldRun: "affected", selected: n, misses: [] }, selection: { total: 100, reason: `${n} of 100` } })
  const pkg = "packages/cli/package.json can affect every test — more than versions and workspace ranges changed"
  const out = aggregateShadow([
    { ...run("u1", full(pkg), full(pkg)), pr: 2283 },
    { ...run("u2", full(pkg), affected(10)), pr: 2290 },
    // another push of the same PR: a run, not another example
    { ...run("u2b", full(pkg), full(pkg)), pr: 2290 },
    { ...run("u3", full("tools/test-select/README.md can affect every test"), full("tools/test-select/README.md can affect every test")), pr: 2301 },
    { ...run("u4", affected(20), affected(30)), pr: 2302 },
    { ...run("u5", { shadow: { wouldRun: "none", selected: 0, misses: [] }, selection: { total: 100 } }, full("backend/src/x.ts was removed or renamed — a test may still import it")) },
    // two different narrowed files: two rows
    { ...run("u7", full("tools/__tests__/fixtures/test-dedup/vitest/vitest.config.mjs can affect every test"), null), pr: 2310 },
    // no PR known, both projects full: still one run, one example
    run("u6", full("frontend/src/y.ts was removed or renamed — a test may still import it"), full("frontend/src/y.ts was removed or renamed — a test may still import it")),
  ])
  assert.equal(out.full.runs, 7)
  assert.deepEqual(out.full.byCause.map((r) => [r.cause, r.runs, r.prs, r.projects]), [
    ["global trigger **/package.json", 3, 2, { frontend: 3, backend: 2 }],
    ["a removed or renamed file", 2, 0, { frontend: 1, backend: 2 }],
    ["no global trigger since 2026-10-18: tools/__tests__/fixtures/test-dedup/vitest/vitest.config.mjs", 1, 1, { frontend: 1, backend: 0 }],
    ["no global trigger since 2026-10-18: tools/test-select/README.md", 1, 1, { frontend: 1, backend: 1 }],
  ])
  assert.deepEqual(out.full.byCause[0].examples, [
    { pr: 2283, url: "u1", file: "packages/cli/package.json" },
    { pr: 2290, url: "u2", file: "packages/cli/package.json" },
  ])
  assert.deepEqual(out.full.byCause[1].examples, [{ pr: null, url: "u5", file: "backend/src/x.ts" }, { pr: null, url: "u6", file: "frontend/src/y.ts" }])
  // every run: frontend 1, 1, 1, 1, 0.2, 0, 1, 1 → 1; narrowed only: 0.2, 0 → 0.1
  assert.equal(out.medianShare.frontend, 1)
  assert.equal(out.narrowed.medianShare.frontend, 0.1)
  assert.equal(out.narrowed.runs.frontend, 2)
  // backend: narrowed 0.1, 0.3 → 0.2
  assert.equal(out.narrowed.medianShare.backend, 0.2)
  assert.equal(out.narrowed.runs.backend, 2)
})
