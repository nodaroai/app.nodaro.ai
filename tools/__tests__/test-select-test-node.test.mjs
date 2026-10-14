// tools/__tests__/test-select-test-node.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { helpersImportingPassThrough, summarizeTest, undeclaredTestReader } from "../test-select/test-node.mjs"

const dep = (path, source = "export const x = 1\n") => ({ path, source })

test("a test-side helper's file reading belongs to the test that imports it", () => {
  const t = summarizeTest({
    file: "backend/src/lib/__tests__/app-run-content-columns.test.ts",
    source: "import { cols } from '../../test/migration-columns'\n",
    deps: [dep("backend/src/test/migration-columns.ts", "const s = readFileSync(p)\n")],
  })
  assert.equal(t.scanner, true)
})

test("an annotated helper passes its watches on instead", () => {
  const t = summarizeTest({
    file: "backend/src/lib/__tests__/a.test.ts", source: "",
    deps: [dep("backend/src/test/migration-columns.ts", "// @test-watches supabase/migrations/*.sql\nreadFileSync(p)\n")],
  })
  assert.equal(t.scanner, false)
  assert.deepEqual(t.watches, ["supabase/migrations/*.sql"])
})

test("product modules: declared reads are collected; the first undeclared reader is named", () => {
  const t = summarizeTest({
    file: "backend/src/lib/mcp/tools/__tests__/skill-loaders.test.ts", source: "",
    deps: [
      dep("backend/src/lib/mcp/tools/skill-loaders.ts", "// @reads backend/skills/**\nreadFileSync(p)\n"),
      dep("backend/src/lib/storage.ts", "readFileSync(tmp)\n"),
      dep("backend/src/lib/upload.ts", "// @reads-none reads only uploads\nreadFileSync(u)\n"),
      dep("packages/shared/dist/index.js"),
    ],
  })
  assert.deepEqual(t.reads, ["backend/skills/**"])
  assert.equal(t.undeclaredReader, "backend/src/lib/storage.ts")
  assert.equal(t.scanner, false)
  assert.deepEqual(t.deps, ["backend/src/lib/mcp/tools/skill-loaders.ts", "backend/src/lib/storage.ts", "backend/src/lib/upload.ts", "packages/shared/dist/index.js"])
})

test("a test's own untagged file reading still marks it, its own annotations clear it", () => {
  assert.equal(summarizeTest({ file: "f.test.ts", source: "readdirSync(d)\n", deps: [] }).scanner, true)
  assert.equal(summarizeTest({ file: "f.test.ts", source: "// @test-always walks the repo\nreaddirSync(d)\n", deps: [] }).scanner, false)
})

test("an unreadable dependency fails safe: a helper counts as an untagged reader, a product module as an undeclared one", () => {
  const helper = summarizeTest({ file: "backend/src/a.test.ts", source: "", deps: [{ path: "backend/src/test/gone.ts", source: null }] })
  assert.equal(helper.scanner, true)
  assert.equal(helper.undeclaredReader, null)
  const product = summarizeTest({
    file: "backend/src/a.test.ts", source: "",
    deps: [dep("backend/src/lib/fine.ts"), { path: "backend/src/lib/gone.ts", source: null }, dep("backend/src/lib/late.ts", "readFileSync(p)\n")],
  })
  assert.equal(product.undeclaredReader, "backend/src/lib/gone.ts")
  assert.equal(product.scanner, false)
  assert.deepEqual(product.deps, ["backend/src/lib/fine.ts", "backend/src/lib/gone.ts", "backend/src/lib/late.ts"])
})

test("@test-always is inherited from a helper (the test's own reason wins)", () => {
  const helper = dep("frontend/src/test-utils/walk.ts", "// @test-always walks every tracked file\nreaddirSync(d)\n")
  assert.equal(summarizeTest({ file: "frontend/src/a.test.ts", source: "", deps: [helper] }).always, "walks every tracked file")
  assert.equal(summarizeTest({ file: "frontend/src/a.test.ts", source: "// @test-always own reason\n", deps: [helper] }).always, "own reason")
})

test("watches from one helper do not hide another helper's untagged file reading", () => {
  const t = summarizeTest({
    file: "backend/src/a.test.ts", source: "",
    deps: [
      dep("backend/src/test/migration-columns.ts", "// @test-watches supabase/migrations/*.sql\nreadFileSync(p)\n"),
      dep("backend/src/lib/__tests__/source-scan.ts", "readdirSync(d)\n"),
    ],
  })
  assert.deepEqual(t.watches, ["supabase/migrations/*.sql"])
  assert.equal(t.scanner, true)
})

// A parse cache that reads only the paths its caller passes: what it reads is
// the importing test's to declare.
const cache = dep("frontend/src/test/source-index.ts",
  "// @test-reads-for-caller reads only the source files the guard passes it\nconst text = fs.readFileSync(file)\n")

test("a @test-reads-for-caller helper: the test's own @test-watches covers what it reads", () => {
  const t = summarizeTest({
    file: "frontend/src/hooks/__tests__/guard.test.ts",
    source: "// @test-watches frontend/src/**/*.ts\nimport { perSourceFile } from '../../test/source-index'\n",
    deps: [cache],
  })
  assert.equal(t.scanner, false)
  assert.deepEqual(t.watches, ["frontend/src/**/*.ts"])
  assert.equal(t.always, null)
  const always = summarizeTest({ file: "frontend/src/a.test.ts", source: "// @test-always walks the tree\n", deps: [cache] })
  assert.equal(always.scanner, false)
  assert.equal(always.always, "walks the tree")
})

test("a @test-reads-for-caller helper under a test that declares nothing runs it on every change", () => {
  const t = summarizeTest({ file: "frontend/src/a.test.ts", source: "import { perSourceFile } from './test/source-index'\n", deps: [cache] })
  assert.equal(t.scanner, true)
  assert.deepEqual(t.watches, [])
})

test("a @test-reads-for-caller helper: only the test's OWN declaration counts, not watches inherited from another helper", () => {
  const t = summarizeTest({
    file: "frontend/src/a.test.ts", source: "",
    deps: [dep("frontend/src/test/migration-columns.ts", "// @test-watches supabase/migrations/*.sql\nreadFileSync(p)\n"), cache],
  })
  assert.deepEqual(t.watches, ["supabase/migrations/*.sql"])
  assert.equal(t.scanner, true)
})

test("a @test-reads-for-caller helper's own watches and always still flow in; the marker only adds that the test must declare too", () => {
  const helper = dep("frontend/src/test/both.ts",
    "// @test-reads-for-caller reads what it is given\n// @test-watches docs/**\n// @test-always why\nreadFileSync(p)\n")
  const bare = summarizeTest({ file: "frontend/src/a.test.ts", source: "", deps: [helper] })
  assert.equal(bare.scanner, true)
  assert.deepEqual(bare.watches, ["docs/**"])
  assert.equal(bare.always, "why")
  const declared = summarizeTest({ file: "frontend/src/a.test.ts", source: "// @test-watches frontend/src/**\n", deps: [helper] })
  assert.equal(declared.scanner, false)
  assert.deepEqual(declared.watches, ["frontend/src/**", "docs/**"])
  assert.equal(declared.always, "why")
})

test("undeclaredTestReader: @test-reads-for-caller is accepted on a test-side helper only", () => {
  const src = "// @test-reads-for-caller reads what it is given\nreadFileSync(p)\n"
  assert.equal(undeclaredTestReader("frontend/src/test/source-index.ts", src), false)
  assert.equal(undeclaredTestReader("frontend/src/lib/__tests__/scan.ts", src), false)
  assert.equal(undeclaredTestReader("frontend/src/lib/__tests__/a.test.ts", src), true)
  assert.equal(undeclaredTestReader("frontend/src/test/x.ts", "readFileSync(p)\n"), true)
  assert.equal(undeclaredTestReader("frontend/src/test/x.ts", "// @test-reads-for-caller\nreadFileSync(p)\n"), true)
  assert.equal(undeclaredTestReader("frontend/src/test/x.ts", "// @test-always why\nreadFileSync(p)\n"), false)
  assert.equal(undeclaredTestReader("frontend/src/test/x.ts", "const a = 1\n"), false)
})

test("a test reaching the pass-through helper THROUGH another helper: deps are transitive, so an undeclared test still runs on every change", () => {
  const t = summarizeTest({
    file: "frontend/src/a.test.ts", source: "import { scan } from './test/b'\n",
    deps: [dep("frontend/src/test/b.ts", "import { perSourceFile } from './source-index'\nexport const scan = (f) => perSourceFile('k', f, (t) => t)\n"), cache],
  })
  assert.equal(t.scanner, true)
  assert.equal(t.passThroughOnly, true)
})

test("passThroughOnly is set only when the pass-through rule is the sole reason the test is a scanner", () => {
  assert.equal(summarizeTest({ file: "frontend/src/a.test.ts", source: "readFileSync(p)\n", deps: [cache] }).passThroughOnly, false)
  assert.equal(summarizeTest({ file: "frontend/src/a.test.ts", source: "readFileSync(p)\n", deps: [] }).passThroughOnly, false)
  assert.equal(summarizeTest({ file: "frontend/src/a.test.ts", source: "", deps: [] }).passThroughOnly, false)
  assert.equal(summarizeTest({ file: "frontend/src/a.test.ts", source: "", deps: [{ path: "frontend/src/test/gone.ts", source: null }, cache] }).passThroughOnly, false)
})

test(".spec files are tests: the test's own file is the caller by construction, and a .spec dependency is not a helper", () => {
  const own = summarizeTest({
    file: "frontend/src/lib/__tests__/a.spec.ts",
    source: "// @test-reads-for-caller reads what it is given\nreadFileSync(p)\n", deps: [],
  })
  assert.equal(own.scanner, true)
  const viaSpec = summarizeTest({
    file: "frontend/src/a.test.ts", source: "",
    deps: [dep("frontend/src/lib/__tests__/b.spec.ts", "// @test-watches docs/**\nreadFileSync(p)\n")],
  })
  assert.deepEqual(viaSpec.watches, [])
  assert.equal(viaSpec.scanner, false)
  assert.equal(undeclaredTestReader("frontend/src/lib/__tests__/a.spec.ts", "// @test-reads-for-caller x\nreadFileSync(p)\n"), true)
})

test("helpersImportingPassThrough: a helper importing a @test-reads-for-caller module must carry the marker or declare", () => {
  const marked = { path: "frontend/src/test/source-index.ts", source: cache.source }
  const b = (source) => ({ path: "frontend/src/lib/__tests__/scan-helper.ts", source })
  const imp = "import { perSourceFile } from '../../test/source-index'\nexport const x = 1\n"
  assert.deepEqual(helpersImportingPassThrough([marked, b(imp)]), ["frontend/src/lib/__tests__/scan-helper.ts"])
  assert.deepEqual(helpersImportingPassThrough([marked, b("import { perSourceFile } from \"@/test/source-index.js\"\n")]), ["frontend/src/lib/__tests__/scan-helper.ts"])
  assert.deepEqual(helpersImportingPassThrough([marked, b("const m = await import('../../test/source-index')\n")]), ["frontend/src/lib/__tests__/scan-helper.ts"])
  assert.deepEqual(helpersImportingPassThrough([marked, b("// @test-reads-for-caller passes on what it is given\n" + imp)]), [])
  assert.deepEqual(helpersImportingPassThrough([marked, b("// @test-watches frontend/src/**\n" + imp)]), [])
  assert.deepEqual(helpersImportingPassThrough([marked, b("// @test-always walks the tree\n" + imp)]), [])
  assert.deepEqual(helpersImportingPassThrough([marked, { path: "frontend/src/lib/__tests__/a.test.ts", source: imp }]), [], "a test file is the caller — the summarizer covers it")
  assert.deepEqual(helpersImportingPassThrough([marked, b("import { x } from '../../test/source-index-extra'\n")]), [])
  assert.deepEqual(helpersImportingPassThrough([b(imp)]), [], "nothing is marked")
  const indexMarked = { path: "frontend/src/test/cache/index.ts", source: cache.source }
  assert.deepEqual(helpersImportingPassThrough([indexMarked, b("import { c } from '../../test/cache'\n")]), ["frontend/src/lib/__tests__/scan-helper.ts"])
})

test("helpersImportingPassThrough sees /index, directory, importActual/importMock and plain template-literal spellings", () => {
  const indexMarked = { path: "frontend/src/test/cache/index.ts", source: cache.source }
  const marked = { path: "frontend/src/test/source-index.ts", source: cache.source }
  const b = (source) => ({ path: "frontend/src/lib/__tests__/scan-helper.ts", source })
  const flagged = ["frontend/src/lib/__tests__/scan-helper.ts"]
  assert.deepEqual(helpersImportingPassThrough([indexMarked, b("import { c } from '../../test/cache/index'\n")]), flagged)
  assert.deepEqual(helpersImportingPassThrough([indexMarked, b("import { c } from '../../test/cache/index.js'\n")]), flagged)
  assert.deepEqual(helpersImportingPassThrough([indexMarked, b("import { c } from '../../test/cache/'\n")]), flagged)
  assert.deepEqual(helpersImportingPassThrough([marked, b("const m = await vi.importActual('../../test/source-index')\n")]), flagged)
  assert.deepEqual(helpersImportingPassThrough([marked, b("const m = await vi.importActual<typeof import('x')>(\"@/test/source-index\")\n")]), flagged)
  assert.deepEqual(helpersImportingPassThrough([marked, b("const m = await vi.importMock('../../test/source-index.js')\n")]), flagged)
  assert.deepEqual(helpersImportingPassThrough([marked, b("const m = await import(`../../test/source-index`)\n")]), flagged)
  assert.deepEqual(helpersImportingPassThrough([marked, b("const m = await vi.importActual<Promise<Record<string, unknown>>>('../../test/source-index')\n")]), flagged)
  assert.deepEqual(helpersImportingPassThrough([indexMarked, b("import { c } from '../../lib/other/index'\n")]), [])
})

test("@test-reads-none: a test or helper that reads no repo files says so", () => {
  assert.equal(summarizeTest({ file: "frontend/src/a.test.ts", source: "// @test-reads-none reads only the temp files it writes\nreadFileSync(tmp)\n", deps: [] }).scanner, false)
  const t = summarizeTest({ file: "frontend/src/a.test.ts", source: "// @test-reads-none reads only the temp files it writes\n", deps: [cache] })
  assert.equal(t.scanner, false)
  assert.equal(undeclaredTestReader("frontend/src/test/x.ts", "// @test-reads-none reads only temp files\nreadFileSync(p)\n"), false)
  assert.equal(undeclaredTestReader("frontend/src/test/x.ts", "// @test-reads-none\nreadFileSync(p)\n"), true)
})

test("helpersImportingPassThrough: @test-reads-none never excuses a helper that imports a @test-reads-for-caller module", () => {
  const marked = { path: "frontend/src/test/source-index.ts", source: cache.source }
  // The forbidden chain: helper H claims @test-reads-none but hands the marked
  // module M repo paths; test T imports H, reads nothing itself and truthfully
  // declares @test-reads-none. The summarizer then has nothing to fire on (T
  // declared), so H's requests would select no test — the guard must fail H.
  const h = { path: "frontend/src/test/b.ts", source: "// @test-reads-none hands it temp files only\nimport { perSourceFile } from './source-index'\nexport const all = perSourceFile(['frontend/src/a.ts'])\n" }
  assert.deepEqual(helpersImportingPassThrough([marked, h]), ["frontend/src/test/b.ts"])
  const t = summarizeTest({ file: "frontend/src/a.test.ts", source: "// @test-reads-none reads nothing itself\nimport { all } from './test/b'\n", deps: [dep(h.path, h.source), dep(marked.path, marked.source)] })
  assert.equal(t.scanner, false, "the summarizer alone cannot see the hole — which is why the guard has to")
  // The declarations that do pass: name the reads, or move them to the caller.
  for (const header of ["// @test-reads-for-caller passes on what it is given\n", "// @test-watches frontend/src/**\n", "// @test-always walks the tree\n"]) {
    assert.deepEqual(helpersImportingPassThrough([marked, { ...h, source: header + h.source }]), [], header)
  }
})

test("helpersImportingPassThrough sees a Prettier multi-line generic and '.'/'./'/'..' directory imports", () => {
  const marked = { path: "frontend/src/test/source-index.ts", source: cache.source }
  const indexMarked = { path: "frontend/src/test/cache/index.ts", source: cache.source }
  const at = (path, source) => ({ path, source })
  assert.deepEqual(helpersImportingPassThrough([marked, at("frontend/src/lib/__tests__/h.ts",
    "const m = await vi.importActual<\n  typeof import('x')\n>('../../test/source-index')\n")]), ["frontend/src/lib/__tests__/h.ts"])
  for (const spec of [".", "./", "./index"]) {
    assert.deepEqual(helpersImportingPassThrough([indexMarked, at("frontend/src/test/cache/sibling.ts", `import { c } from '${spec}'\n`)]),
      ["frontend/src/test/cache/sibling.ts"], spec)
  }
  for (const spec of ["..", "../", "../index.js"]) {
    assert.deepEqual(helpersImportingPassThrough([indexMarked, at("frontend/src/test/cache/sub/deep.ts", `import { c } from '${spec}'\n`)]),
      ["frontend/src/test/cache/sub/deep.ts"], spec)
  }
  assert.deepEqual(helpersImportingPassThrough([indexMarked, at("frontend/src/test/other/h.ts", "import { c } from '.'\n")]), [])
  assert.deepEqual(helpersImportingPassThrough([indexMarked, at("frontend/src/test/cache/sub/deep.ts", "import { c } from '.'\n")]), [])
})

test("helpersImportingPassThrough: a stray '<' never swallows the imports after it", () => {
  const marked = { path: "frontend/src/test/source-index.ts", source: cache.source }
  const at = (source) => ({ path: "frontend/src/test/h.ts", source })
  assert.deepEqual(helpersImportingPassThrough([marked, at(
    "vi.mock(\"./a\", async () => ({ ...(await vi.importActual<typeof import(\"./a\")>()) }))\nimport { p } from \"./source-index\"\nconst f = () => \"x\"\n")]),
  ["frontend/src/test/h.ts"])
  assert.deepEqual(helpersImportingPassThrough([marked, at(
    "// re-exports from <repo>/test\nimport { p } from './source-index'\nconst f = (a) => 'x'\n")]),
  ["frontend/src/test/h.ts"])
  const started = Date.now()
  helpersImportingPassThrough([marked, at("from <x>\n".repeat(20000))])
  assert.ok(Date.now() - started < 500, "linear on a pathological '<' flood")
})
