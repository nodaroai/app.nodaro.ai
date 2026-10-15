// tools/__tests__/test-select-rules.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { DECLARED_TEST_DATA, selectTests } from "../test-select/select.mjs"

const T = (file, deps = [], extra = {}) => ({ file, deps, watches: [], always: null, scanner: false, reads: [], undeclaredReader: null, ...extra })
const tests = [
  T("frontend/src/gallery/__tests__/gallery.test.tsx", ["frontend/src/gallery/gallery.tsx", "frontend/src/lib/i18n/en.ts"]),
  T("frontend/src/nodes/__tests__/pitch.test.ts", ["frontend/src/nodes/pitch.ts", "packages/shared/dist/index.js"]),
  T("frontend/src/__tests__/no-hardcoded-copy.test.ts", [], { scanner: false, watches: ["frontend/src/**/*.tsx"] }),
  T("frontend/src/__tests__/legacy-scan.test.ts", [], { scanner: true }),
  T("frontend/src/__tests__/always.test.ts", [], { always: "walks git ls-files" }),
  T("frontend/src/nodes/__tests__/snap.test.ts", ["frontend/src/nodes/snap.ts"]),
]
const M = (path) => ({ status: "M", path })
const run = (changes) => selectTests({ project: "frontend", changes, tests })
const files = (sel) => sel.files.map((f) => f.file)

test("a gallery change selects the gallery test, the watcher, the untagged and always-run tests — not the node test", () => {
  const sel = run([M("frontend/src/gallery/gallery.tsx")])
  assert.equal(sel.mode, "affected")
  assert.deepEqual(files(sel), [
    "frontend/src/__tests__/always.test.ts",
    "frontend/src/__tests__/legacy-scan.test.ts",
    "frontend/src/__tests__/no-hardcoded-copy.test.ts",
    "frontend/src/gallery/__tests__/gallery.test.tsx",
  ])
  assert.match(sel.files.find((f) => f.file.endsWith("gallery.test.tsx")).why, /imports frontend\/src\/gallery\/gallery\.tsx/)
})

test("a package source change selects every test that uses the package's build", () => {
  const sel = run([M("packages/shared/src/model-catalog.ts")])
  assert.ok(files(sel).includes("frontend/src/nodes/__tests__/pitch.test.ts"))
  assert.ok(!files(sel).includes("frontend/src/gallery/__tests__/gallery.test.tsx"))
})

test("a package's own test file does not select app tests", () => {
  const sel = run([M("packages/shared/src/__tests__/catalog.test.ts")])
  assert.ok(!files(sel).includes("frontend/src/nodes/__tests__/pitch.test.ts"))
})

test("a changed test file and a changed snapshot select their test", () => {
  assert.ok(files(run([M("frontend/src/nodes/__tests__/pitch.test.ts")])).includes("frontend/src/nodes/__tests__/pitch.test.ts"))
  assert.ok(files(run([M("frontend/src/nodes/__tests__/__snapshots__/snap.test.ts.snap")])).includes("frontend/src/nodes/__tests__/snap.test.ts"))
})

test("global triggers run everything", () => {
  for (const p of ["package-lock.json", "frontend/package.json", "frontend/vitest.config.ts", "frontend/tsconfig.json", "frontend/src/test/setup.ts", ".github/workflows/ci.yml", "tools/test-select/select.mjs",
    // the ffmpeg binary the backend's real-ffmpeg e2e tests run against is pinned here
    "Dockerfile", "tools/install-pinned-ffmpeg.sh"]) {
    const sel = run([M(p)])
    assert.equal(sel.mode, "full", p)
    assert.match(sel.reason, new RegExp(p.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")))
  }
})

test("REVIEW FOCUS 1: removing or renaming a module runs everything", () => {
  assert.equal(run([{ status: "D", path: "frontend/src/nodes/pitch.ts" }]).mode, "full")
  assert.equal(run([{ status: "D", path: "packages/shared/src/x.ts" }]).mode, "full")
  // deleting a test file cannot break another test
  assert.notEqual(run([{ status: "D", path: "frontend/src/nodes/__tests__/old.test.ts" }]).mode, "full")
})

test("a removal anywhere under frontend/, backend/ or packages/ runs everything, for either project", () => {
  // frontend tests import backend files by path (tutorial-seed templates,
  // workflow-engine fixtures): a rename there breaks them with no edge to see
  const D = (path) => ({ status: "D", path })
  for (const p of ["backend/src/lib/tutorial-seed/templates/x.json", "backend/src/services/workflow-engine/__tests__/fixtures/w.json"]) {
    const sel = run([D(p)])
    assert.equal(sel.mode, "full", p)
    assert.match(sel.reason, /removed or renamed/)
  }
  assert.equal(selectTests({ project: "backend", changes: [D("frontend/src/lib/x.ts")], tests }).mode, "full")
  assert.equal(run([D("packages/prompts/tsup.config.ts")]).mode, "full")
  assert.equal(run([D("packages/shared/README.md")]).mode, "full")
  // another project's test file is still not a module anything imports
  assert.notEqual(run([D("backend/src/lib/__tests__/old.test.ts")]).mode, "full")
})

test("a change anywhere in a package (its build config included) selects its consumers; its tests and docs do not", () => {
  for (const p of ["packages/shared/tsup.config.ts", "packages/shared/scripts/gen.mjs"]) {
    assert.ok(files(run([M(p)])).includes("frontend/src/nodes/__tests__/pitch.test.ts"), p)
  }
  for (const p of ["packages/shared/CHANGELOG.md", "packages/shared/README.md", "packages/shared/docs/guide.md",
    "packages/shared/__tests__/x.test.ts", "packages/shared/test/y.test.ts", "packages/shared/src/__tests__/fixture-helper.ts"]) {
    assert.ok(!files(run([M(p)])).includes("frontend/src/nodes/__tests__/pitch.test.ts"), p)
  }
  // markdown under src/ may be bundled into the build: it still counts
  assert.ok(files(run([M("packages/shared/src/prompts/doctrine.md")])).includes("frontend/src/nodes/__tests__/pitch.test.ts"))
})

test("REVIEW FOCUS 4: a non-code file read at run time selects its declared readers and every test reaching an undeclared reader", () => {
  const md = M("backend/skills/nodes/pitch-tempo.md")
  const declared = T("backend/src/lib/mcp/tools/__tests__/skill-loaders.test.ts", ["backend/src/lib/mcp/tools/skill-loaders.ts"], { reads: ["backend/skills/**"] })
  const undeclared = T("backend/src/lib/__tests__/storage.test.ts", ["backend/src/lib/storage.ts"], { undeclaredReader: "backend/src/lib/storage.ts" })
  const unrelated = T("backend/src/lib/__tests__/math.test.ts", ["backend/src/lib/math.ts"])
  const watcher = T("backend/src/__tests__/recipes.test.ts", [], { watches: ["backend/skills/**"] })
  const sel = selectTests({ project: "backend", changes: [md], tests: [declared, undeclared, unrelated, watcher] })
  assert.equal(sel.mode, "affected")
  assert.deepEqual(sel.files.map((f) => f.file).sort(), [declared.file, undeclared.file, watcher.file].sort())
  assert.match(sel.files.find((f) => f.file === undeclared.file).why, /storage\.ts, which reads files without declaring @reads/)
  // a non-code file outside the project (supabase/, docs/, .claude/) is covered the same way
  assert.deepEqual(selectTests({ project: "backend", changes: [M("supabase/migrations/500_x.sql")], tests: [undeclared, unrelated] }).files.map((f) => f.file), [undeclared.file])
  // CLAUDE.md is never read: nothing selected
  assert.equal(selectTests({ project: "backend", changes: [M("backend/CLAUDE.md")], tests: [undeclared] }).mode, "none")
  // a code-module change does not wake undeclared readers (they are reached through imports, if at all)
  assert.equal(selectTests({ project: "backend", changes: [M("backend/src/lib/math.ts")], tests: [undeclared] }).mode, "none")
  // nobody reads it at all → nothing to run (the old "orphan → full" rule is gone)
  assert.equal(selectTests({ project: "backend", changes: [md], tests: [unrelated] }).mode, "none")
})

test("a declared @reads glob also selects on a module-file change it names (product code reading source as text)", () => {
  const gen = T("backend/src/__tests__/gen.test.ts", ["backend/src/scripts/gen.ts"], { reads: ["frontend/src/types/nodes.ts"] })
  assert.equal(selectTests({ project: "backend", changes: [M("frontend/src/types/nodes.ts")], tests: [gen] }).mode, "affected")
})

test("TestNode objects without the reader fields are read as no reads and no undeclared reader", () => {
  const old = { file: "backend/src/a.test.ts", deps: ["backend/src/a.ts"], watches: [], always: null, scanner: false }
  assert.equal(selectTests({ project: "backend", changes: [M("backend/skills/x.md")], tests: [old] }).mode, "none")
})

test("manual mocks and huge diffs run everything", () => {
  assert.equal(run([M("frontend/src/lib/__mocks__/supabase.ts")]).mode, "full")
  assert.equal(run(Array.from({ length: 2900 }, (_, i) => M(`docs/${i}.md`))).mode, "full")
})

test("a change outside the project that nothing reads selects only the always-run tests", () => {
  const sel = run([M("docs/api-integration.md")])
  assert.deepEqual(files(sel), ["frontend/src/__tests__/always.test.ts", "frontend/src/__tests__/legacy-scan.test.ts"])
})

test("no tests at all affected → none", () => {
  assert.equal(selectTests({ project: "frontend", changes: [M("docs/x.md")], tests: [T("frontend/src/a.test.ts", ["frontend/src/a.ts"])] }).mode, "none")
})

test("test data read at run time (goldens, fixtures) runs everything; a snapshot still selects only its owner", () => {
  const sel = (p) => selectTests({ project: p.split("/")[0], changes: [M(p)], tests })
  const golden = sel("backend/src/providers/video/__tests__/__goldens__/video-overlay-graph/one-card.txt")
  assert.equal(golden.mode, "full")
  assert.match(golden.reason, /one-card\.txt is test data read at run time/)
  assert.equal(sel("frontend/src/lib/__tests__/fixtures/workflow.json").mode, "full")
  assert.equal(sel("frontend/src/lib/__fixtures__/a.png").mode, "full")
  assert.equal(sel("frontend/src/test-utils/fixtures.csv").mode, "full")
  // a watcher claiming the file does not exempt it
  const watcher = T("backend/src/providers/video/__tests__/video-overlay-graph.test.ts", [], { watches: ["backend/src/providers/video/__tests__/__goldens__/**"] })
  assert.equal(selectTests({ project: "backend", changes: [M("backend/src/providers/video/__tests__/__goldens__/video-overlay-graph/one-card.txt")], tests: [watcher] }).mode, "full")
  // a snapshot is owned by the snapshot rule
  const snap = sel("frontend/src/nodes/__tests__/__snapshots__/snap.test.ts.snap")
  assert.equal(snap.mode, "affected")
  assert.ok(snap.files.some((f) => f.file === "frontend/src/nodes/__tests__/snap.test.ts"))
  // a JS/TS test helper is code: the graph sees it
  assert.notEqual(sel("frontend/src/lib/__tests__/helpers.ts").mode, "full")
  // test data of the OTHER project does not run this one in full
  assert.notEqual(selectTests({ project: "frontend", changes: [M("backend/src/providers/video/__tests__/__goldens__/x.txt")], tests }).mode, "full")
})

test("any README.md and any .json wake undeclared readers (only CLAUDE.md is never read)", () => {
  const undeclared = T("backend/src/lib/__tests__/docs-inventory.test.ts", ["backend/src/lib/docs-inventory.ts"], { undeclaredReader: "backend/src/lib/docs-inventory.ts" })
  for (const p of ["docs/nodes/README.md", "backend/src/x/data.json"]) {
    const sel = selectTests({ project: "backend", changes: [M(p)], tests: [undeclared] })
    assert.deepEqual(sel.files.map((f) => f.file), [undeclared.file], p)
  }
  assert.equal(selectTests({ project: "backend", changes: [M("docs/CLAUDE.md")], tests: [undeclared] }).mode, "none")
})

test("a test inheriting watches from one helper while another helper is an untagged reader is selected even when no watched file changed", () => {
  const t = T("backend/src/a.test.ts", ["backend/src/a.ts"], { watches: ["supabase/migrations/*.sql"], scanner: true })
  const sel = selectTests({ project: "backend", changes: [M("backend/src/unrelated.ts")], tests: [t] })
  assert.deepEqual(sel.files.map((f) => f.file), [t.file])
  assert.match(sel.files[0].why, /reads files at run time/)
})

test("a test that is a scanner only through a pass-through helper says so", () => {
  const t = T("frontend/src/a.test.ts", ["frontend/src/test/source-index.ts"], { scanner: true, passThroughOnly: true })
  const sel = selectTests({ project: "frontend", changes: [M("frontend/src/x.ts")], tests: [t, T("frontend/src/b.test.ts", [], { scanner: true })] })
  assert.equal(sel.files.find((f) => f.file === "frontend/src/a.test.ts").why,
    "uses a helper that reads only what its caller passes, and declares no @test-watches/@test-always/@test-reads-none")
  assert.equal(sel.files.find((f) => f.file === "frontend/src/b.test.ts").why,
    "reads files at run time (itself or through a test helper) and declares no @test-watches/@test-always/@test-reads-none")
})

test(".spec files count as test files: removing one does not force the full suite", () => {
  const sel = selectTests({ project: "frontend", changes: [{ status: "D", path: "frontend/src/lib/__tests__/a.spec.ts" }], tests: [T("frontend/src/b.test.ts")] })
  assert.notEqual(sel.mode, "full")
})

// decided 2026-10-15: a release bump is no global trigger.
test("a version-only manifest or lockfile bump is no global trigger; any other manifest change still is", () => {
  const bump = run([{ status: "M", path: "package.json", versionOnly: true }, { status: "M", path: "package-lock.json", versionOnly: true }])
  assert.notEqual(bump.mode, "full")
  assert.equal(run([M("package.json")]).mode, "full")
  // a package's own bumped manifest still selects that package's consumers (its build may inline the version)
  const pkg = selectTests({ project: "frontend", tests, changes: [{ status: "M", path: "packages/shared/package.json", versionOnly: true }] })
  assert.deepEqual(files(pkg).filter((f) => f.includes("pitch")), ["frontend/src/nodes/__tests__/pitch.test.ts"])
})

test("a declared golden selects its readers; any other test data still runs everything", () => {
  const golden = "frontend/src/__tests__/fixtures/golden.json"
  const withReader = [...tests, T("frontend/src/__tests__/golden.test.ts", [], { watches: [golden] })]
  const sel = (path, declared) => {
    const original = [...DECLARED_TEST_DATA]
    DECLARED_TEST_DATA.splice(0, DECLARED_TEST_DATA.length, ...declared)
    try { return selectTests({ project: "frontend", tests: withReader, changes: [M(path)] }) } finally {
      DECLARED_TEST_DATA.splice(0, DECLARED_TEST_DATA.length, ...original)
    }
  }
  const declared = sel(golden, [golden])
  assert.equal(declared.mode, "affected")
  assert.ok(files(declared).includes("frontend/src/__tests__/golden.test.ts"))
  assert.ok(!files(declared).includes("frontend/src/nodes/__tests__/pitch.test.ts"))
  assert.equal(sel(golden, []).mode, "full")
  assert.equal(sel("frontend/src/__tests__/fixtures/other.json", [golden]).mode, "full")
})
