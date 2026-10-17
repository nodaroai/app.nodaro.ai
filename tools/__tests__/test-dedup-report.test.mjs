// tools/__tests__/test-dedup-report.test.mjs
// The duplicate report's pure parts, on fixture workflows, graphs and sources —
// no Vitest, and TypeScript only where it resolves (the tools self-test job
// runs with no npm install).
// @test-watches tools/test-dedup/** .github/workflows/ci.yml
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { copies, duplicateBodies, extractTests, resolveSpecifier } from "../test-dedup/bodies.mjs"
import { clusterSaving, mergeClusters, parseDurations, perDependency, stemOf } from "../test-dedup/clusters.mjs"
import { classifyCrossTree } from "../test-dedup/cross-tree.mjs"
import { discoverByGrep, duplicateExecutions, eventsAllowed, invocationsOf, parityDiscovery, splitJobs, splitSteps } from "../test-dedup/executions.mjs"
import { projectsOf, renderReport } from "../test-dedup/report.mjs"

const WORKFLOW = `name: CI

on:
  push:
    branches: [main, dev]
  pull_request:

jobs:
  backend-test-shards:
    name: Backend Tests (\${{ matrix.shard }}/4)
    steps:
      - uses: actions/checkout@v5
      - name: Run tests
        working-directory: backend
        run: bash ../tools/test-select/run-suite.sh
      - name: Run @nodaro/shared test suite
        if: \${{ matrix.shard == 2 }}
        run: npm run test --workspace=@nodaro/shared

  ledger:
    name: Ledger (real Redis)
    steps:
      - name: Run the ledger suites
        working-directory: backend
        run: npx vitest run src/lib/__tests__/ledger.redis.test.ts

  typecheck:
    name: Type Check
    steps:
      - name: Checks in parallel
        run: |
          cross_tree_parity() {
            cd backend
            files=()
            while IFS= read -r f; do files+=("$f"); done < <(
              grep -rl -e 'frontend/' -e 'frontend"' src --include='*.test.ts' | sort
            )
            npx vitest run --testTimeout=30000 "\${files[@]}"
          }
          start parity cross_tree_parity

  i18n:
    name: i18n Locale Completeness
    steps:
      - name: matrix
        run: npm run test --workspace=@nodaro/shared -- src/__tests__/locales.test.ts

  push-only:
    name: Push Only
    if: github.event_name == 'push'
    steps:
      - name: again
        run: npm run test --workspace=@nodaro/shared -- src/__tests__/other.test.ts
`

const SOURCES = {
  "backend/src/lib/__tests__/a.test.ts": "readFileSync(join(root, 'frontend/src/x.ts'))\n",
  "backend/src/lib/__tests__/b.test.ts": "it('x', () => {})\n",
  "backend/src/lib/__tests__/c.test.ts": 'const p = "frontend"\ndescribe.skipIf(!process.env.X)("gated", () => {})\n',
  "backend/src/lib/__tests__/ledger.redis.test.ts": "describe.skipIf(!redis)('real', () => {})\n",
  "backend/src/lib/helper.ts": "// frontend/ in a product module, not a test\n",
  "packages/shared/src/__tests__/locales.test.ts": "",
  "packages/shared/src/__tests__/other.test.ts": "",
  "packages/shared/dist/x.test.ts": "",
}
const tracked = Object.keys(SOURCES)
const read = (p) => SOURCES[p] ?? null
const packageDirs = new Map([["@nodaro/shared", "packages/shared"]])

test("jobs and steps split the way the workflow reads; matrix expressions are blanked in names", () => {
  const jobs = splitJobs(WORKFLOW)
  assert.deepEqual(jobs.map((j) => j.id), ["backend-test-shards", "ledger", "typecheck", "i18n", "push-only"])
  assert.equal(jobs[0].name, "Backend Tests (*/4)")
  const steps = splitSteps(jobs[0].text)
  assert.deepEqual(steps.map((s) => [s.name, s.workingDirectory, s.run]), [
    [null, null, null],
    ["Run tests", "backend", "bash ../tools/test-select/run-suite.sh"],
    ["Run @nodaro/shared test suite", null, "npm run test --workspace=@nodaro/shared"],
  ])
})

test("event conditions: an == pins, a != drops, an || keeps every event", () => {
  const all = ["push", "pull_request"]
  assert.deepEqual(eventsAllowed("github.event_name == 'push'", all), ["push"])
  assert.deepEqual(eventsAllowed("github.event_name != 'push'", all), ["pull_request"])
  assert.deepEqual(eventsAllowed("github.event_name == 'push' || inputs.x", all), all)
  assert.deepEqual(eventsAllowed(null, all), all)
})

test("the parity discovery is read out of the workflow, and its grep emulated over the tree", () => {
  const run = splitSteps(splitJobs(WORKFLOW)[2].text)[0].run
  const d = parityDiscovery(run)
  assert.deepEqual(d, { function: "cross_tree_parity", cwd: "backend", dir: "src", include: "*.test.ts", patterns: ["frontend/", 'frontend"'] })
  assert.deepEqual(discoverByGrep(d, tracked.map((p) => ({ path: p, source: SOURCES[p] }))),
    ["backend/src/lib/__tests__/a.test.ts", "backend/src/lib/__tests__/c.test.ts"])
  assert.equal(discoverByGrep({ ...d, patterns: ["front.nd"] }, []), null, "a BRE operator is not emulated")
})

test("invocations: the suite, a whole package, one package file, a listed file", () => {
  const steps = splitJobs(WORKFLOW).flatMap((j) => splitSteps(j.text))
  const kinds = steps.flatMap((s) => invocationsOf(s, packageDirs)).map((i) => i.kind)
  assert.deepEqual(kinds, ["suite", "package", "files", "discover", "package", "package"])
})

test("a file run by two executions on one event is a duplicate; a push-only second run is not one on pull_request; a listed env-gated file is labelled", () => {
  const { duplicates } = duplicateExecutions(WORKFLOW, { tracked, read, packageDirs })
  const byFile = Object.fromEntries(duplicates.map((d) => [d.file, d]))
  assert.deepEqual(Object.keys(byFile).sort(), [
    "backend/src/lib/__tests__/a.test.ts",
    "backend/src/lib/__tests__/c.test.ts",
    "backend/src/lib/__tests__/ledger.redis.test.ts",
    "packages/shared/src/__tests__/locales.test.ts",
    "packages/shared/src/__tests__/other.test.ts",
  ])
  assert.deepEqual(byFile["packages/shared/src/__tests__/other.test.ts"].events, ["push"])
  assert.deepEqual(byFile["backend/src/lib/__tests__/a.test.ts"].executions, ["Backend Tests (*/4) / Run tests", "Type Check / Checks in parallel"])
  assert.equal(byFile["backend/src/lib/__tests__/ledger.redis.test.ts"].envGated, true)
  assert.equal(byFile["backend/src/lib/__tests__/c.test.ts"].envGated, false, "runIf/skipIf alone is not enough: no dedicated job lists it")
  assert.equal(duplicates.some((d) => d.file.includes("/dist/")), false, "a package's dist is never a test")
})

const deps = (n, prefix = "backend/src/m") => Array.from({ length: n }, (_, i) => `${prefix}${i}.ts`)
const clusterSources = {
  "backend/src/x/__tests__/payload-builder-a.test.ts": "vi.mock('../db')\n",
  "backend/src/x/__tests__/payload-builder-b.test.ts": "vi.mock('../db')\n",
  "backend/src/x/__tests__/payload-c.test.ts": "vi.mock('../db')\n",
  "backend/src/x/__tests__/payload-other-mocks.test.ts": "vi.mock('../cache')\n",
  "backend/src/x/__tests__/payload-far.test.ts": "vi.mock('../db')\n",
  "backend/src/x/__tests__/payload-small.test.ts": "vi.mock('../db')\n",
  "backend/src/x/__tests__/payload-small-too.test.ts": "vi.mock('../db')\n",
  "backend/src/w/__tests__/chain-a.test.ts": "",
  "backend/src/w/__tests__/chain-b.test.ts": "",
  "backend/src/w/__tests__/chain-c.test.ts": "",
  "frontend/src/y/__tests__/use-a.test.ts": "",
  "frontend/src/y/__tests__/use-b.test.ts": "",
}

test("merge clusters: same dir + stem + mock set, ≥ 50 deps, complete-linkage Jaccard ≥ 0.9, no shared-worker file", () => {
  const graph = [
    { file: "backend/src/x/__tests__/payload-builder-a.test.ts", deps: deps(60) },
    { file: "backend/src/x/__tests__/payload-builder-b.test.ts", deps: deps(60) },
    { file: "backend/src/x/__tests__/payload-c.test.ts", deps: [...deps(60), "backend/src/extra.ts"] },
    { file: "backend/src/x/__tests__/payload-other-mocks.test.ts", deps: deps(60) },
    { file: "backend/src/x/__tests__/payload-far.test.ts", deps: [...deps(30), ...deps(30, "backend/src/z")] },
    { file: "backend/src/x/__tests__/payload-small.test.ts", deps: deps(10) },
    { file: "backend/src/x/__tests__/payload-small-too.test.ts", deps: deps(10) },
    // a chain: a ~ b and b ~ c (J ≈ 0.91), but a ≁ c (J ≈ 0.82) — complete linkage keeps c out
    { file: "backend/src/w/__tests__/chain-a.test.ts", deps: deps(60) },
    { file: "backend/src/w/__tests__/chain-b.test.ts", deps: deps(66) },
    { file: "backend/src/w/__tests__/chain-c.test.ts", deps: deps(66).slice(6) },
    { file: "frontend/src/y/__tests__/use-a.test.ts", deps: deps(60) },
    { file: "frontend/src/y/__tests__/use-b.test.ts", deps: deps(60) },
  ]
  const clusters = mergeClusters(graph, { read: (p) => clusterSources[p], sharedWorker: new Set(["frontend/src/y/__tests__/use-b.test.ts"]) })
  assert.deepEqual(clusters.map((c) => c.files), [[
    "backend/src/x/__tests__/payload-builder-a.test.ts",
    "backend/src/x/__tests__/payload-builder-b.test.ts",
    "backend/src/x/__tests__/payload-c.test.ts",
  ], [
    "backend/src/w/__tests__/chain-a.test.ts",
    "backend/src/w/__tests__/chain-b.test.ts",
  ]])
  assert.equal(clusters[0].stem, "payload")
  assert.equal(clusters[0].mergedFiles, 1)
  assert.equal(stemOf("a/b/review-inspector.budget.test.tsx"), "review")
})

test("the saving model: Σ deps − k · max deps, times the per-dependency load cost; never more files than today", () => {
  const cluster = { deps: [100, 100, 120], mergedFiles: 1 }
  assert.equal(clusterSaving(cluster, 0.01), (320 - 120) * 0.01)
  assert.equal(clusterSaving(cluster, 0.01, 2), (320 - 240) * 0.01)
  assert.equal(clusterSaving(cluster, null), null)
  assert.equal(perDependency([{ import: 6, environment: 2 }, { import: 2 }], [{ deps: deps(50) }, { deps: deps(50) }]), 0.1)
  assert.equal(perDependency(null, []), null)
})

test("durations come from the largest Vitest run of a log, raw or caret-escaped colours alike", () => {
  const log = [
    "\u001b[2m Test Files \u001b[22m 55 passed (55)",
    "\u001b[2m   Duration \u001b[22m 46.66s (transform 3.51s, setup 4.94s, import 14.71s, tests 35.20s, environment 31.42s)",
    "Backend\tUNKNOWN STEP\t2026-10-16T12:34:15Z ^[[2m Test Files ^[[22m ^[[1m^[[32m359 passed^[[39m^[[22m^[[90m (359)^[[39m",
    "Backend\tUNKNOWN STEP\t2026-10-16T12:34:15Z ^[[2m   Duration ^[[22m 198.93s^[[2m (transform 30.26s, setup 11.24s, import 174.66s, tests 105.10s, environment 16ms)^[[22m",
  ].join("\n")
  assert.deepEqual(parseDurations(log), { files: 359, transform: 30.26, setup: 11.24, import: 174.66, tests: 105.1, environment: 0.016 })
  assert.equal(parseDurations("no vitest here"), null)
})

const t = (file, scope, title, body, subjects = [], context = "c") => ({ file, scope, title, body, subjects, context })
const LONG = `{ expect(buildPayload({ type: "x", data: { prompt: "a long enough body" } })).toEqual({ ok: true }) }`

test("copy-pasted bodies: same scope is a candidate; across files the subjects and the context must match too", () => {
  const r = duplicateBodies([
    t("a.test.ts", "suite", "one", LONG), t("a.test.ts", "suite", "two", LONG), t("a.test.ts", "other", "three", LONG),
    t("a.test.ts", "suite", "short", "{ x() }"), t("a.test.ts", "suite", "short again", "{ x() }"),
    t("b.test.ts", "suite", "twin", LONG, ["buildPayload<backend/src/payload>"]),
    t("c.test.ts", "suite", "twin", LONG, ["buildPayload<backend/src/payload>"]),
    t("d.test.ts", "suite", "other engine", LONG, ["buildPayload<frontend/src/payload>"]),
    t("e.test.ts", "suite", "other mocks", LONG, ["buildPayload<backend/src/payload>"], "c2"),
  ])
  assert.deepEqual(r.sameScope, [{ file: "a.test.ts", scope: "suite", titles: ["one", "two"] }])
  assert.equal(copies(r.sameScope, (g) => g.titles.length), 1)
  assert.deepEqual(r.crossFile.map((g) => g.files), [["b.test.ts", "c.test.ts"]])
  assert.equal(r.long, 7)
})

test("specifiers resolve to repo paths, so twin tests of the two engines never share a subject", () => {
  assert.equal(resolveSpecifier("backend/src/a/__tests__/x.test.ts", "../payload-builder.js"), "backend/src/a/payload-builder")
  assert.equal(resolveSpecifier("frontend/src/a/x.test.ts", "@/lib/api"), "frontend/src/lib/api")
  assert.equal(resolveSpecifier("frontend/src/a/x.test.ts", "@nodaro/shared/catalog"), "@nodaro/shared/catalog")
})

let ts = null
try { ts = createRequire(new URL("../../package.json", import.meta.url))("typescript") } catch { /* no npm install here */ }

test("bodies come from the AST: comments and layout never matter, describe chains and hooks are kept", { skip: !ts && "typescript is not installed" }, () => {
  const source = `import { run } from "../run"
vi.mock("../db", () => ({}))
describe("outer", () => {
  beforeEach(() => reset())
  it("a", () => {
    // a comment
    expect(run({ type: "generate-image", data: { prompt: "one long prompt" } })).toBe(1)
  })
  it("b", () => { expect(run({ type: "generate-image", data: { prompt: "one long prompt" } })).toBe(1) })
  describe("inner", () => {
    test("c", function () { expect(run({ type: "generate-image", data: { prompt: "one long prompt" } })).toBe(1) })
  })
})
`
  const tests = extractTests(ts, "backend/src/x/__tests__/run.test.ts", source)
  assert.deepEqual(tests.map((x) => [x.scope, x.title]), [["outer", "a"], ["outer", "b"], ["outer > inner", "c"]])
  assert.equal(tests[0].body, tests[1].body)
  assert.deepEqual(tests[0].subjects, ["run<backend/src/x/run>"])
  assert.equal(tests[0].context, tests[1].context)
  assert.deepEqual(duplicateBodies(tests).sameScope.map((g) => g.titles), [["a", "b"]])
})

test("--project: frontend, backend, every package with a test script, or one of them", () => {
  const manifests = [
    { dir: "packages/shared", pkg: { scripts: { test: "vitest run" } } },
    { dir: "packages/render-rules", pkg: {} },
    { dir: "packages/prompts", pkg: { scripts: { test: "vitest run" } } },
  ]
  assert.deepEqual(projectsOf("backend", manifests), ["backend"])
  assert.deepEqual(projectsOf("packages", manifests), ["packages/prompts", "packages/shared"])
  assert.deepEqual(projectsOf("packages/shared", manifests), ["packages/shared"])
  assert.equal(projectsOf("packages/render-rules", manifests), null, "no test script")
  assert.equal(projectsOf("tools", manifests), null)
  assert.equal(projectsOf("packages", []), null)
})

test("parameterized and skipped forms are not read; describe.each folds into the enclosing scope", { skip: !ts && "typescript is not installed" }, () => {
  const body = `{ expect(run({ type: "generate-image", data: { prompt: "one long prompt" } })).toBe(1) }`
  const source = [
    `it.each([1, 2])("each %s", () => ${body})`,
    `it.skip("skipped", () => ${body})`,
    `it.skipIf(x)("skipIf", () => ${body})`,
    `it.fails("fails", () => ${body})`,
    `describe.each([1])("table %s", () => { it("inside each", () => ${body}) })`,
    `it("plain", () => ${body})`,
  ].join("\n")
  const tests = extractTests(ts, "backend/src/x/__tests__/run.test.ts", source)
  assert.deepEqual(tests.map((x) => [x.scope, x.title]), [["", "inside each"], ["", "plain"]])
})

test("cross-tree classification follows the graph summary", () => {
  const graph = [
    { file: "w.test.ts", deps: [], watches: ["frontend/src/types/nodes.ts"], always: null, scanner: false },
    { file: "o.test.ts", deps: [], watches: ["supabase/migrations/*.sql"], always: null, scanner: false },
    { file: "s.test.ts", deps: [], watches: [], always: null, scanner: true },
    { file: "i.test.ts", deps: ["frontend/src/lib/x.ts"], watches: [], always: null, scanner: false },
    { file: "n.test.ts", deps: ["backend/src/x.ts"], watches: [], always: null, scanner: false },
    { file: "a.test.ts", deps: [], watches: [], always: "walks the tree", scanner: false },
  ]
  assert.deepEqual(classifyCrossTree([...graph.map((g) => g.file), "gone.test.ts"], graph).map((x) => x.category),
    ["watch-frontend", "watch-other", "undeclared-scanner", "imports-frontend", "neither", "always", "not-in-graph"])
})

test("the report renders every section from its inputs", () => {
  const md = renderReport({
    project: "backend",
    executions: duplicateExecutions(WORKFLOW, { tracked, read, packageDirs }),
    clusters: [{ dir: "backend/src/x/__tests__", stem: "payload", files: ["a", "b"], deps: [60, 60], lines: 100, mergedFiles: 1 }],
    perDep: 0.01,
    bodies: { total: 3, long: 2, sameScope: [{ file: "a.test.ts", scope: "s", titles: ["one", "two"] }], crossFile: [] },
    crossTree: [{ file: "x.test.ts", category: "neither", importsFrontend: false }],
  })
  for (const heading of ["## (a)", "## (b)", "## (c)", "## (d)"]) assert.ok(md.includes(heading), heading)
  assert.match(md, /\*\*4 files run twice or more\*\* \(1 more switch on the environment/)
  assert.match(md, /\*\*1 clusters, 2 files\*\*/)
  assert.match(md, /\| `backend\/src\/x\/__tests__\/payload\*` \| 2 \| 100 \| 1 \| 0\.6 s \|/)
  assert.match(md, /Same describe scope: 1 copies in 1 groups/)
  assert.match(md, /\| neither \| 1 \|/)
})

test("ci.yml still has the parity discovery the report and the cross-tree guard read", () => {
  const yml = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8")
  const parity = splitJobs(yml).flatMap((j) => splitSteps(j.text)).flatMap((s) => invocationsOf(s, new Map())).filter((i) => i.kind === "discover")
  assert.equal(parity.length, 1)
  assert.equal(parity[0].discovery.cwd, "backend")
  assert.ok(parity[0].discovery.patterns.includes("frontend/"))
})
