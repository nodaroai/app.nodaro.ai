// tools/__tests__/test-select-shadow-report.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { aggregateShadow, resolveBase, shadowExpected } from "../test-select/shadow-report.mjs"

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
  assert.deepEqual(aggregateShadow([]), { runsChecked: 0, misses: [], unattributed: [], crashed: [], missing: [], errors: [], selectionErrors: [], clean: false, medianShare: { frontend: null, backend: null } })
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
