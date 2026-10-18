// tools/__tests__/test-select-enforced-audit.test.mjs
// The selector's audit after enforcement (enforced-audit.mjs, decided
// 2026-10-18). The artifact shapes below are copied from real runs: PR #2332's
// final enforced run 39118467049 (its selection-frontend-1 artifact) and its
// merge aa97e61ba's post-merge run 39120351077 (jobs and failed-frontend-1).
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  aggregateEnforced, auditProject, collectEnforcedAudits, finalRun, needsBase, overallClean, postMergeFailures, projectPath,
  renderEnforced, selectLineFromLog, selectionFromArtifacts,
} from "../test-select/enforced-audit.mjs"
import { aggregateShadow, ghError, renderReport } from "../test-select/shadow-report.mjs"

const VIDEO_OVERLAY = "src/components/editor/config-panels/__tests__/video-overlay-config.test.tsx"
const why = "imports (directly or through any chain) a changed file"

// selection-frontend.json from run 39118467049, files cut down to three (993 in the run)
const SELECTION_2332 = {
  mode: "affected",
  reason: "993 of 1472 test files can be affected",
  files: [
    { file: "frontend/src/__tests__/billing-admin-route-registration.test.ts", why },
    { file: `frontend/${VIDEO_OVERLAY}`, why },
    { file: "frontend/src/lib/__tests__/node-families.test.ts", why },
  ],
  registryRule: {
    mode: "shadow",
    selection: {
      mode: "affected", reason: "993 of 1472 test files can be affected",
      files: [
        { file: "frontend/src/__tests__/billing-admin-route-registration.test.ts", why },
        { file: `frontend/${VIDEO_OVERLAY}`, why },
        { file: "frontend/src/lib/__tests__/node-families.test.ts", why },
      ],
    },
  },
  total: 1472,
  merge: "e9674a1c9aefe25632d58c9a11f7e727d7251bd0",
  base: "fd6c8ed1fe1a9cfeb3f3263d454d5c866f974096",
}

// run 39120351077 (push of aa97e61ba to dev), every attempt
const DEV_RUN_2332 = {
  url: "https://github.com/nodaroai/app.nodaro.ai-internal/actions/runs/39120351077",
  status: "completed",
  conclusion: "failure",
  artifacts: ["failed-frontend-1", "ci-build-packages", "proven-frontend-1"],
  jobs: [
    { name: "Frontend Tests (2/4)", conclusion: "success", testStep: "success" },
    { name: "Frontend Tests (4/4)", conclusion: "success", testStep: "success" },
    { name: "Frontend Tests (3/4)", conclusion: "success", testStep: "success" },
    { name: "Frontend Tests (1/4)", conclusion: "failure", testStep: "failure" },
    { name: "Frontend Tests", conclusion: "failure", testStep: "" },
    { name: "Backend Tests (1/4)", conclusion: "success", testStep: "success" },
    { name: "Backend Tests (2/4)", conclusion: "success", testStep: "success" },
    { name: "Backend Tests (3/4)", conclusion: "success", testStep: "success" },
    { name: "Backend Tests (4/4)", conclusion: "success", testStep: "success" },
  ],
}
// failed-frontend-1: failed-frontend.txt (0 bytes), .flaky (one line), .unknown (0 bytes)
const LISTS_2332 = { "failed-frontend-1": { failed: [], flaky: [VIDEO_OVERLAY], unknown: [] } }
const readFrom = (lists) => (name) => {
  if (!lists[name]) throw new Error(`${name}: not downloadable`)
  return lists[name]
}

test("enforced audit: #2332 — the file its post-merge run labelled flaky is listed as flaky (in the selection), never a miss", () => {
  const selection = selectionFromArtifacts("frontend", [1, 2, 3, 4].map((shard) => ({ shard, selection: SELECTION_2332 })))
  assert.equal(selection.status, "affected")
  // repo-relative in the JSON, project-relative here: the form the failed lists use
  assert.ok(selection.files.includes(VIDEO_OVERLAY))
  assert.equal(selection.base, "fd6c8ed1fe1a9cfeb3f3263d454d5c866f974096")
  const post = postMergeFailures({ sha: "aa97e61ba7f94870929878a16fa80e63ab491170", project: "frontend", devRuns: [DEV_RUN_2332], readLists: readFrom(LISTS_2332) })
  assert.deepEqual(post.flaky, [VIDEO_OVERLAY])
  assert.deepEqual(post.failed, [])
  assert.deepEqual(post.unattributed, [])
  assert.equal(needsBase(selection, post), false) // nothing failed again: no base lookup
  const r = auditProject({ selection, post })
  assert.deepEqual(r.misses, [])
  assert.deepEqual(r.flaky, [{ file: VIDEO_OVERLAY, inSelection: true }])
  const backend = postMergeFailures({ sha: "aa97e61ba", project: "backend", devRuns: [DEV_RUN_2332], readLists: readFrom(LISTS_2332) })
  assert.deepEqual(backend, { sha: "aa97e61ba", url: DEV_RUN_2332.url, failed: [], flaky: [], unknown: [], unattributed: [] })
  const e = aggregateEnforced([{
    pr: 2332, state: "audited", url: "https://github.com/nodaroai/app.nodaro.ai-internal/actions/runs/39118467049",
    mergeUrl: DEV_RUN_2332.url, runs: 1, superseded: 0,
    projects: { frontend: r, backend: auditProject({ selection: { status: "none" }, post: backend }) },
  }])
  assert.equal(e.misses.length, 0)
  assert.deepEqual(e.flaky, [{ project: "frontend", pr: 2332, url: DEV_RUN_2332.url, file: VIDEO_OVERLAY, inSelection: true }])
  assert.equal(e.clean, true)
  const text = renderEnforced(e).join("\n")
  assert.match(text, /Enforced misses .*: 0/)
  assert.ok(text.includes(`frontend: ${VIDEO_OVERLAY}  #2332 ${DEV_RUN_2332.url}  (in the PR's selection)`))
})

test("enforced audit: a file that failed again outside the final selection is a miss, unless it failed again on the base's dev run", () => {
  const selection = { status: "affected", files: ["src/a.test.ts"], base: "b".repeat(40) }
  const post = { sha: "m", url: "dev-run", failed: ["src/a.test.ts", "src/b.test.ts", "src/c.test.ts", "src/d.test.ts"], flaky: ["src/e.test.ts"], unknown: [], unattributed: [] }
  assert.equal(needsBase(selection, post), true)
  const base = { sha: "b".repeat(40), url: "base-run", failed: ["src/c.test.ts"], flaky: ["src/d.test.ts"], unknown: [] }
  const r = auditProject({ selection, post, base })
  assert.deepEqual(r.covered, [{ file: "src/a.test.ts" }])
  assert.deepEqual(r.inherited, [{ file: "src/c.test.ts", base: "b".repeat(40), baseUrl: "base-run" }])
  assert.deepEqual(r.misses.map((m) => m.file), ["src/b.test.ts", "src/d.test.ts"])
  assert.match(r.misses[1].baseNote, /labelled flaky/) // only flaky on the base: still a miss
  assert.deepEqual(r.flaky, [{ file: "src/e.test.ts", inSelection: false }]) // flaky outside the selection: still not a miss
  // the base could not be checked: the miss stays, with why
  const unknownBase = auditProject({ selection, post: { ...post, failed: ["src/b.test.ts"] }, base: { sha: "b".repeat(40), error: "its dev run has not finished" } })
  assert.match(unknownBase.misses[0].baseNote, /not checked: its dev run has not finished/)
})

test("enforced audit: a project the PR ran none of (selection none, or the Diff Gate skipped it) misses whatever fails again; a full run misses nothing", () => {
  const post = { failed: ["src/x.test.ts"], flaky: [], unknown: ["src/y.test.ts"], unattributed: [2] }
  for (const selection of [{ status: "none" }, { status: "untested", why: "skipped" }]) {
    const r = auditProject({ selection, post })
    assert.deepEqual(r.misses, [{ file: "src/x.test.ts" }])
    assert.deepEqual(r.unknown, [{ file: "src/y.test.ts" }])
    assert.deepEqual(r.unattributed, [2])
  }
  const full = auditProject({ selection: { status: "full" }, post })
  assert.deepEqual(full.misses, [])
  assert.deepEqual(full.unknown, [])
  assert.deepEqual(full.unattributed, []) // nothing was skipped: a crash says nothing about the selector
  assert.deepEqual(full.covered, [{ file: "src/x.test.ts" }, { file: "src/y.test.ts", unknown: true }])
})

test("enforced audit: the post-merge lists — keyed on the Run tests step, every shard read, a shard that failed with no list is an error", () => {
  const sha = "m"
  const run = (jobs, artifacts = [], extra = {}) => [{ url: "dev", status: "completed", conclusion: "failure", artifacts, jobs, ...extra }]
  const shard = (n, conclusion, testStep) => ({ name: `Backend Tests (${n}/4)`, conclusion, testStep })
  // the job is red but its tests passed (picker-ui's suite runs on shard 1): nothing to read
  assert.deepEqual(postMergeFailures({ sha, project: "backend", devRuns: run([shard(1, "failure", "success")]), readLists: () => assert.fail("no list to read") }).failed, [])
  // red tests and no list
  assert.match(postMergeFailures({ sha, project: "backend", devRuns: run([shard(3, "failure", "failure")]), readLists: () => ({}) }).error, /failed its tests and left no failed-backend-3 list/)
  // red tests and three empty lists: no file named — unattributed
  const crash = postMergeFailures({ sha, project: "backend", devRuns: run([shard(2, "failure", "failure")], ["failed-backend-2"]), readLists: () => ({ failed: [], flaky: [], unknown: [] }) })
  assert.deepEqual(crash.unattributed, [2])
  // the step never finished: no full suite ran there
  assert.match(postMergeFailures({ sha, project: "backend", devRuns: run([shard(4, "failure", "skipped")]), readLists: () => ({}) }).error, /never finished its Run tests step \(skipped\)/)
  // an unreadable list
  assert.match(postMergeFailures({ sha, project: "backend", devRuns: run([shard(1, "failure", "failure")], ["failed-backend-1"]), readLists: () => { throw new Error("gh run download: unexpected end of JSON input") } }).error, /^failed-backend-1: gh run download: unexpected end of JSON input/)
  // a re-run that went green keeps attempt 1's lists, and they are read
  const rerun = postMergeFailures({ sha, project: "backend", devRuns: run([shard(1, "failure", "failure"), shard(1, "success", "success")], ["failed-backend-1"], { conclusion: "success" }), readLists: () => ({ failed: ["src/z.test.ts"], flaky: [], unknown: [] }) })
  assert.deepEqual(rerun.failed, ["src/z.test.ts"])
  // shards are unioned
  const two = postMergeFailures({ sha, project: "backend", devRuns: run([shard(1, "failure", "failure"), shard(2, "failure", "failure")], ["failed-backend-1", "failed-backend-2"]),
    readLists: (name) => (name.endsWith("1") ? { failed: ["src/b.test.ts"], flaky: ["src/f.test.ts"], unknown: [] } : { failed: ["src/a.test.ts"], flaky: [], unknown: [] }) })
  assert.deepEqual([two.failed, two.flaky], [["src/a.test.ts", "src/b.test.ts"], ["src/f.test.ts"]])
  // not finished, never run, ended neither way
  assert.equal(postMergeFailures({ sha, project: "backend", devRuns: [{ url: "dev", status: "in_progress" }], readLists: () => ({}) }).pending, true)
  assert.match(postMergeFailures({ sha, project: "backend", devRuns: [], readLists: () => ({}) }).error, /no CI run of it on dev/)
  assert.match(postMergeFailures({ sha, project: "backend", devRuns: run([], [], { conclusion: "cancelled" }), readLists: () => ({}) }).error, /ended cancelled/)
})

test("enforced audit: an enforced run is told by its artifacts, or by the Select line in its log — the JSON's mode alone is the selector's choice", () => {
  // the job log as GitHub serves it (run 39116773670, Frontend Tests (1/4))
  const log = [
    "2026-10-18T09:57:20.0000000Z ##[group]Run if [ \"$MODE\" = \"affected\" ]; then",
    "2026-10-18T09:57:20.0000000Z   node tools/test-select/cli.mjs --project frontend --merge-commit \\",
    "2026-10-18T09:57:44.1331923Z frontend: affected — 140 of 1472 test files can be affected",
  ].join("\n")
  assert.deepEqual(selectLineFromLog(log, "frontend"), { ci: "enforced", selection: "affected" })
  assert.equal(selectLineFromLog(log, "backend"), null)
  assert.deepEqual(selectLineFromLog("2026-10-17T10:00:00.1Z backend: shadow (would run: none) — no test can be affected", "backend"), { ci: "shadow", selection: "none" })
  assert.deepEqual(selectLineFromLog("2026-10-18T11:00:00.1Z backend: none — no test in this project can be affected", "backend"), { ci: "enforced", selection: "none" })
  // a selection artifact that is not an enforced selection, shards that disagree, nothing readable
  assert.match(selectionFromArtifacts("frontend", [{ shard: 1, selection: { ...SELECTION_2332, mode: "full" } }]).error, /mode "full", not "affected"/)
  assert.match(selectionFromArtifacts("frontend", [{ shard: 1, selection: SELECTION_2332 }, { shard: 2, selection: { ...SELECTION_2332, files: [] } }]).error, /disagree/)
  assert.match(selectionFromArtifacts("frontend", [{ shard: 1, error: "selection-frontend-1: gh run download 1: unexpected end of JSON input" }]).error, /unexpected end of JSON input/)
  // one unreadable shard among readable ones: the selection stands, the unreadable artifact is reported
  const partial = selectionFromArtifacts("frontend", [{ shard: 1, selection: SELECTION_2332 }, { shard: 2, error: "selection-frontend-2: boom" }])
  assert.equal(partial.status, "affected")
  assert.deepEqual(partial.unreadable, ["selection-frontend-2: boom"])
  assert.equal(projectPath("backend", "backend/src/a.test.ts"), "src/a.test.ts")
  assert.equal(projectPath("backend", "src/a.test.ts"), "src/a.test.ts")
})

test("enforced audit: the registry rule — in shadow, a miss is what the main selection held and the rule's did not; enforced, its misses are the selector's", () => {
  const post = { failed: ["src/u.test.ts", "src/v.test.ts"], flaky: [], unknown: [], unattributed: [] }
  const shadowRule = { status: "affected", files: ["src/u.test.ts", "src/v.test.ts"], registry: { mode: "shadow", selection: { mode: "affected", files: ["src/v.test.ts"] } } }
  const r = auditProject({ selection: shadowRule, post })
  assert.deepEqual(r.misses, [])
  assert.deepEqual(r.registry, { mode: "shadow", differs: true, misses: ["src/u.test.ts"] })
  // inherited from the base: not the rule's miss either
  const inh = auditProject({ selection: shadowRule, post, base: { sha: "b", url: "u", failed: ["src/u.test.ts"] } })
  assert.deepEqual(inh.registry.misses, [])
  // same selections: nothing said about the rule
  assert.equal(auditProject({ selection: { ...shadowRule, registry: { mode: "shadow", selection: { mode: "affected", files: shadowRule.files } } }, post }).registry.differs, false)
  const enforced = auditProject({ selection: { status: "affected", files: ["src/v.test.ts"], registry: { mode: "enforce", selection: { mode: "affected", files: ["src/v.test.ts"] } } }, post })
  assert.deepEqual(enforced.misses, [{ file: "src/u.test.ts" }])
  assert.deepEqual(enforced.registry, { mode: "enforce", misses: ["src/u.test.ts"] })
  const e = aggregateEnforced([
    { pr: 1, state: "audited", url: "r1", mergeUrl: "d1", runs: 1, superseded: 0, projects: { backend: r } },
    { pr: 2, state: "audited", url: "r2", mergeUrl: "d2", runs: 1, superseded: 0, projects: { backend: enforced } },
  ])
  assert.deepEqual(e.registry, { checked: 1, misses: [{ project: "backend", pr: 1, url: "d1", file: "src/u.test.ts" }], enforced: 1, enforcedMisses: 1 })
  assert.equal(e.misses.length, 1) // the enforced rule's miss, counted once — as a selector miss
  assert.equal(e.clean, false)
})

test("enforced audit: an unmerged PR is counted and has nothing to audit; a pending post-merge run or an unreadable check blocks Clean", () => {
  const audited = { pr: 3, state: "audited", url: "r3", mergeUrl: "d3", runs: 3, superseded: 2, projects: { frontend: auditProject({ selection: { status: "full" }, post: { failed: [], flaky: [], unknown: [], unattributed: [] } }) } }
  const unmerged = { pr: 4, state: "unmerged", url: "r4", runs: 2 }
  const e = aggregateEnforced([audited, unmerged, { pr: 5, state: "shadow-final", url: "r5", runs: 1 }])
  assert.deepEqual(e.prs, { audited: 1, unmerged: 1, pending: 0, "shadow-final": 1, error: 0 })
  assert.deepEqual(e.runs, { final: 1, superseded: 2, unmerged: 2, pending: 0, "shadow-final": 1, error: 0 })
  assert.equal(e.errors.length, 0)
  assert.equal(e.clean, true)
  assert.equal(aggregateEnforced([audited, { pr: 6, state: "pending", url: "r6", mergeUrl: "d6", runs: 1 }]).clean, false)
  const err = aggregateEnforced([audited, { pr: 7, state: "error", url: "r7", runs: 1, error: "PR #7 could not be read" }])
  assert.deepEqual(err.errors, [{ pr: 7, url: "r7", error: "PR #7 could not be read" }])
  assert.equal(err.clean, false)
  assert.equal(aggregateEnforced([audited], [{ url: "r8", error: "mode unreadable" }]).clean, false)
  assert.equal(aggregateEnforced([unmerged]).clean, false) // nothing audited: no evidence
  // a selection artifact that could not be read, beside readable ones
  assert.equal(aggregateEnforced([{ ...audited, projects: { frontend: { ...audited.projects.frontend, unreadable: ["selection-frontend-2: boom"] } } }]).errors.length, 1)
})

test("enforced audit: the final selection is the newest run of the head the PR merged with", () => {
  const runs = [{ id: "10", headSha: "a" }, { id: "12", headSha: "b" }, { id: "11", headSha: "b" }]
  assert.equal(finalRun(runs, "b").id, "12")
  assert.equal(finalRun(runs, "c"), null)
})

test("report: an enforced run is no longer missing shadow data; Clean covers the shadow runs and the enforced PRs; the listing adds up", () => {
  const shadow = aggregateShadow([{ url: "s1", expected: ["frontend"], projects: { frontend: { shadow: { wouldRun: "affected", selected: 1, misses: [] }, selection: { total: 10 } } } }])
  const enforced = aggregateEnforced([{ pr: 2332, state: "audited", url: "r", mergeUrl: "d", runs: 1, superseded: 0, projects: {} }])
  assert.equal(overallClean(shadow, enforced), true)
  assert.equal(overallClean(aggregateShadow([]), enforced), true) // enforced PRs alone are evidence
  assert.equal(overallClean(aggregateShadow([]), aggregateEnforced([])), false)
  const missing = aggregateShadow([{ url: "s2", expected: ["backend"], projects: {} }])
  assert.equal(overallClean(missing, enforced), false)
  const kinds = { shadow: 1, enforced: 1, "not into dev": 2, "no test job finished": 0, "mode unreadable": 0 }
  const lines = renderReport({ since: "2026-10-18", listed: 4, kinds, report: shadow, enforced })
  assert.equal(lines[0], "PR runs listed since 2026-10-18: 4 — shadow 1, enforced 1, not into dev 2, no test job finished 0, mode unreadable 0")
  assert.equal(Object.values(kinds).reduce((a, b) => a + b, 0), 4)
  assert.ok(lines.some((l) => l.startsWith("Clean: across 1 shadow run(s) and 1 audited enforced PR(s)")))
  assert.ok(lines.includes("Missing shadow data (a shadow run's test job ran, no shadow artifact): 0"))
})

test("gh errors name the call and carry gh's own message — never printed bare above the report", () => {
  const err = Object.assign(new Error("Command failed: gh run download 39139021404 --repo o/r --name selection-backend-2 --dir /tmp/x"), { stderr: "unexpected end of JSON input\n" })
  assert.equal(ghError(["run", "download", "39139021404", "--repo", "o/r", "--name", "selection-backend-2", "--dir", "/tmp/x"], err).message,
    "gh run download 39139021404 --name selection-backend-2: unexpected end of JSON input")
  assert.equal(ghError(["api", "--paginate", "repos/o/r/pulls/1", "--jq", "."], { message: "Command failed", stderr: "HTTP 404: Not Found\n" }).message, "gh api repos/o/r/pulls/1: HTTP 404: Not Found")
})

test("collection: #2332 end to end through a fake gh, and an unmerged PR whose empty merged_at survives gh's trimmed output", () => {
  const head2332 = "728a5d252bd785d1211afb9e5809aa5d59633b1d"
  const merge2332 = "aa97e61ba7f94870929878a16fa80e63ab491170"
  const calls = []
  // gh() trims its output: an unmerged PR's row "<head>\tdev\t\t" arrives as "<head>\tdev"
  const gh = (...args) => {
    calls.push(args.join(" "))
    const path = args.find((a, i) => i > 0 && !a.startsWith("-"))
    if (path === "repos/o/r/pulls/2332") return `${head2332}\tdev\t2026-10-18T10:43:01Z\t${merge2332}`
    if (path === "repos/o/r/pulls/2340") return "f".repeat(40) + "\tdev"
    if (path.startsWith(`repos/o/r/actions/workflows/ci.yml/runs?head_sha=${merge2332}`)) return `39120351077\t${DEV_RUN_2332.url}\tcompleted\tfailure`
    if (path === "repos/o/r/actions/runs/39120351077/artifacts?per_page=100") return DEV_RUN_2332.artifacts.join("\n")
    if (path.startsWith("repos/o/r/actions/runs/39120351077/jobs")) return DEV_RUN_2332.jobs.map((j) => [j.name, j.conclusion, j.testStep].join("\t")).join("\n")
    throw new Error(`unexpected gh call: ${args.join(" ")}`)
  }
  const selection = selectionFromArtifacts("frontend", [{ shard: 1, selection: SELECTION_2332 }])
  const { prs, unclassified } = collectEnforcedAudits({
    repo: "o/r", gh, listedByHead: new Map(),
    enforcedRuns: [
      { id: "39118467049", url: "run-2332", headSha: head2332, pr: 2332, jobs: [], projects: { frontend: selection, backend: { status: "none" } } },
      { id: "39200000000", url: "run-2340", headSha: "f".repeat(40), pr: 2340, jobs: [], projects: { frontend: { status: "full" } } },
    ],
    readLists: (runId, name) => { assert.equal(runId, "39120351077"); return readFrom(LISTS_2332)(name) },
    devFailures: () => assert.fail("no miss: the base is never looked up"),
    baseFromJobLog: () => assert.fail("no miss: the base is never looked up"),
  })
  assert.deepEqual(unclassified, [])
  assert.deepEqual(prs.map((p) => [p.pr, p.state]), [[2332, "audited"], [2340, "unmerged"]])
  const e = aggregateEnforced(prs)
  assert.deepEqual(e.flaky.map((m) => [m.pr, m.file, m.inSelection]), [[2332, VIDEO_OVERLAY, true]])
  assert.equal(e.misses.length, 0)
  assert.equal(e.clean, true)
})

test("collection: an enforced run whose PR could not be found carries the lookup's own error", () => {
  const { prs, unclassified } = collectEnforcedAudits({
    repo: "o/r", gh: () => assert.fail("no gh call without a PR"), listedByHead: new Map(),
    enforcedRuns: [{ id: "1", url: "run-1", headSha: "a", pr: null, prError: "gh api repos/o/r/commits/a/pulls: unexpected end of JSON input", jobs: [], projects: {} }],
    readLists: () => ({}), devFailures: () => ({}), baseFromJobLog: () => ({ error: "x" }),
  })
  assert.deepEqual(prs, [])
  assert.deepEqual(unclassified, [{ url: "run-1", error: "an enforced run whose PR could not be found (gh api repos/o/r/commits/a/pulls: unexpected end of JSON input)" }])
  assert.equal(aggregateEnforced(prs, unclassified).clean, false)
})
