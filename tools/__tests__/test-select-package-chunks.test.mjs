// tools/__tests__/test-select-package-chunks.test.mjs
// A package src change selects only the tests that load an output built from
// it — when the package's build metafile says which outputs those are. Every
// doubt falls back to the whole-package rule (any test reaching the package).
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { chunkMapFromMetafiles, loadPackageChunks } from "../test-select/package-chunks.mjs"
import { selectTests } from "../test-select/select.mjs"

// The shape esbuild writes (probed with `esbuild --splitting --metafile`):
// keys relative to the directory tsup ran in — the package directory.
// `inputs` is the input graph (each module and what it imports, resolved to
// another input's key, or a package left external); each output lists the
// inputs it carries bytes from.
const imp = (p, kind = "import-statement") => ({ path: p, kind, original: `./${path.posix.basename(p).replace(/\.ts$/, "")}` })
const ESM = {
  inputs: {
    "src/a.ts": { bytes: 10, imports: [imp("src/shared.ts"), { path: "react", kind: "import-statement", external: true }], format: "esm" },
    "src/b.ts": { bytes: 10, imports: [imp("src/shared.ts"), imp("src/lazy.ts", "dynamic-import")], format: "esm" },
    "src/c.ts": { bytes: 10, imports: [], format: "esm" },
    "src/shared.ts": { bytes: 10, imports: [{ path: "src/prompts/doctrine.md", kind: "import-statement", original: "./prompts/doctrine.md" }], format: "esm" },
    "src/lazy.ts": { bytes: 10, imports: [], format: "esm" },
    "src/prompts/doctrine.md": { bytes: 4, imports: [] },
  },
  outputs: {
    "dist/a.js": { inputs: { "src/a.ts": { bytesInOutput: 10 } }, imports: [{ path: "dist/chunk-SHARED.js", kind: "import-statement" }, { path: "react", kind: "import-statement", external: true }] },
    "dist/a.js.map": { inputs: {}, imports: [] },
    "dist/b.js": { inputs: { "src/b.ts": { bytesInOutput: 10 } }, imports: [{ path: "dist/chunk-SHARED.js", kind: "import-statement" }, { path: "dist/lazy-L.js", kind: "dynamic-import" }] },
    "dist/c.js": { inputs: { "src/c.ts": { bytesInOutput: 10 } }, imports: [] },
    "dist/chunk-SHARED.js": { inputs: { "src/shared.ts": { bytesInOutput: 10 }, "src/prompts/doctrine.md": { bytesInOutput: 4 } }, imports: [] },
    "dist/lazy-L.js": { inputs: { "src/lazy.ts": { bytesInOutput: 10 } }, imports: [] },
  },
}
const CJS = {
  inputs: {
    "src/a.ts": { bytes: 10, imports: [imp("src/shared.ts")], format: "esm" },
    "src/shared.ts": { bytes: 10, imports: [], format: "esm" },
  },
  outputs: { "dist/a.cjs": { inputs: { "src/a.ts": { bytesInOutput: 10 }, "src/shared.ts": { bytesInOutput: 10 } }, imports: [] } },
}
const SHARED = "packages/shared/"
const chunks = (...metafiles) => ({ [SHARED]: chunkMapFromMetafiles("packages/shared", metafiles) })

const T = (file, deps) => ({ file, deps, watches: [], always: null, scanner: false, reads: [], undeclaredReader: null })
const usesA = T("frontend/src/__tests__/uses-a.test.ts", ["frontend/src/x.ts", "packages/shared/dist/a.js", "packages/shared/dist/chunk-SHARED.js"])
const usesB = T("frontend/src/__tests__/uses-b.test.ts", ["packages/shared/dist/b.js", "packages/shared/dist/chunk-SHARED.js"])
const usesC = T("frontend/src/__tests__/uses-c.test.ts", ["packages/shared/dist/c.js"])
// Vitest's walk may not list a chunk an entry imports: the metafile's imports cover it
const usesBEntryOnly = T("frontend/src/__tests__/uses-b-entry.test.ts", ["packages/shared/dist/b.js"])
const usesCjs = T("backend/src/__tests__/uses-cjs.test.ts", ["packages/shared/dist/a.cjs"])
const usesSrc = T("frontend/src/__tests__/uses-src.test.ts", ["packages/shared/src/other.ts"])
const unrelated = T("frontend/src/__tests__/unrelated.test.ts", ["frontend/src/y.ts"])
// usesCjs joins only the tests about the cjs build
const all = [usesA, usesB, usesC, usesBEntryOnly, usesSrc, unrelated]
const everyPackageUser = [usesA, usesB, usesBEntryOnly, usesC, usesSrc].map((t) => t.file).sort()

const M = (p) => ({ status: "M", path: p })
const pick = (changes, packageChunks, tests = all) =>
  selectTests({ project: "frontend", changes: changes.map((c) => (typeof c === "string" ? M(c) : c)), tests, packageChunks }).files.map((f) => f.file).sort()

test("a module only in entry chunk A selects A's consumers, not B's or C's", () => {
  assert.deepEqual(pick(["packages/shared/src/a.ts"], chunks(ESM)), [usesA.file, usesSrc.file].sort())
})

test("a module in a shared chunk selects the consumers of every entry that imports the chunk", () => {
  assert.deepEqual(pick(["packages/shared/src/shared.ts"], chunks(ESM)), [usesA.file, usesB.file, usesBEntryOnly.file, usesSrc.file].sort())
})

test("a dynamically imported chunk selects the consumers of the entry that imports it", () => {
  assert.deepEqual(pick(["packages/shared/src/lazy.ts"], chunks(ESM)), [usesB.file, usesBEntryOnly.file, usesSrc.file].sort())
})

test("the reason names the output and the source it was built from", () => {
  const sel = selectTests({ project: "frontend", changes: [M("packages/shared/src/c.ts")], tests: all, packageChunks: chunks(ESM) })
  assert.match(sel.files.find((f) => f.file === usesC.file).why, /uses packages\/shared\/dist\/c\.js, built from packages\/shared\/src\/c\.ts, which changed/)
})

test("markdown bundled from src/ is an input like any module", () => {
  assert.deepEqual(pick(["packages/shared/src/prompts/doctrine.md"], chunks(ESM)), [usesA.file, usesB.file, usesBEntryOnly.file, usesSrc.file].sort())
})

test("the esm and cjs metafiles are merged", () => {
  assert.ok(pick(["packages/shared/src/shared.ts"], chunks(ESM, CJS), [...all, usesCjs]).includes(usesCjs.file))
  assert.ok(!pick(["packages/shared/src/c.ts"], chunks(ESM, CJS), [...all, usesCjs]).includes(usesCjs.file))
})

test("a test reaching a package file no metafile describes keeps the whole-package rule", () => {
  // the cjs build exists, only the esm metafile does: a.cjs is unknown
  const sel = selectTests({ project: "frontend", changes: [M("packages/shared/src/c.ts")], tests: [...all, usesCjs], packageChunks: chunks(ESM) })
  const files = sel.files.map((f) => f.file)
  assert.ok(files.includes(usesCjs.file))
  assert.match(sel.files.find((f) => f.file === usesCjs.file).why, /packages\/shared\/dist\/a\.cjs.*no build metafile/)
  // a test importing package source by path is never narrowed
  assert.ok(files.includes(usesSrc.file))
  assert.ok(!files.includes(usesA.file))
})

test("a missing metafile → whole package (today's rule)", () => {
  assert.deepEqual(pick(["packages/shared/src/a.ts"], {}), everyPackageUser)
  assert.deepEqual(pick(["packages/shared/src/a.ts"], undefined), everyPackageUser)
  assert.deepEqual(pick(["packages/shared/src/a.ts"], { [SHARED]: null }), everyPackageUser)
})

test("a metafile of the wrong shape → whole package", () => {
  for (const bad of [null, "x", [], {}, { inputs: {}, outputs: [] }, { inputs: {}, outputs: { "dist/a.js": {} } }, { inputs: {}, outputs: { "dist/a.js": { inputs: [] } } },
    { inputs: {}, outputs: { "dist/a.js": { inputs: {}, imports: "x" } } },
    { inputs: { "src/a.ts": {} }, outputs: {} }, { inputs: { "src/a.ts": { imports: "x" } }, outputs: {} },
    { inputs: { "src/a.ts": { imports: [{ kind: "import-statement" }] } }, outputs: {} }]) {
    assert.equal(chunkMapFromMetafiles("packages/shared", [bad]), null, JSON.stringify(bad))
  }
  assert.equal(chunkMapFromMetafiles("packages/shared", []), null)
  assert.equal(chunkMapFromMetafiles("packages/shared", [ESM, null]), null)
})

test("a changed src file that is in no output (a new file, a type-only module) → whole package", () => {
  assert.deepEqual(pick([{ status: "A", path: "packages/shared/src/new.ts" }], chunks(ESM)), everyPackageUser)
  assert.deepEqual(pick(["packages/shared/src/types.ts"], chunks(ESM)), everyPackageUser)
})

test("one resolvable and one unresolvable change in the same package → whole package", () => {
  assert.deepEqual(pick(["packages/shared/src/c.ts", "packages/shared/src/types.ts"], chunks(ESM)), everyPackageUser)
})

test("a non-src package change (build config, scripts) → whole package", () => {
  assert.deepEqual(pick(["packages/shared/tsup.config.ts"], chunks(ESM)), everyPackageUser)
  assert.deepEqual(pick(["packages/shared/src/c.ts", "packages/shared/scripts/gen.mjs"], chunks(ESM)), everyPackageUser)
})

test("metafile keys that do not match the package's paths behave exactly like whole package", () => {
  // e.g. tsup run from the repo root: keys come out repo-relative and the
  // normalized outputs name files no test loads
  const root = (k) => `packages/shared/${k}`
  const rooted = {
    inputs: Object.fromEntries(Object.entries(ESM.inputs).map(([k, v]) => [root(k), {
      ...v, imports: v.imports.map((i) => (i.external ? i : { ...i, path: root(i.path) })),
    }])),
    outputs: Object.fromEntries(Object.entries(ESM.outputs).map(([k, v]) => [root(k), {
      ...v, inputs: Object.fromEntries(Object.keys(v.inputs).map((i) => [root(i), {}])),
      imports: v.imports.map((i) => (i.external ? i : { ...i, path: root(i.path) })),
    }])),
  }
  assert.notEqual(chunkMapFromMetafiles("packages/shared", [rooted]), null, "the shape is valid — only the keys are off")
  assert.deepEqual(pick(["packages/shared/src/c.ts"], chunks(rooted)), everyPackageUser)
})

test("precise mode only narrows the package rule: imports, watchers and other packages still select", () => {
  const watcher = { ...T("frontend/src/__tests__/watch.test.ts", []), watches: ["packages/shared/src/**"] }
  const other = T("frontend/src/__tests__/prompts.test.ts", ["packages/prompts/dist/index.js"])
  const got = pick(["packages/shared/src/c.ts", "packages/prompts/src/x.ts"], chunks(ESM), [...all, watcher, other])
  assert.deepEqual(got, [usesC.file, usesSrc.file, watcher.file, other.file].sort())
  // a changed file a test imports directly is still an import hit
  assert.ok(pick(["packages/shared/src/other.ts"], chunks(ESM)).includes(usesSrc.file))
})

test("package tests and docs still select nothing in precise mode", () => {
  assert.deepEqual(pick(["packages/shared/src/__tests__/a.test.ts", "packages/shared/README.md"], chunks(ESM)), [])
})

// --- the loader ------------------------------------------------------------

const repo = () => mkdtempSync(path.join(tmpdir(), "test-select-chunks-"))
const write = (root, rel, text) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text)
}
const writeBuild = (root, pkg, metafile, outputs = ["dist/a.js", "dist/a.js.map", "dist/b.js", "dist/c.js", "dist/chunk-SHARED.js", "dist/lazy-L.js"]) => {
  for (const o of outputs) write(root, `packages/${pkg}/${o}`, "")
  write(root, `packages/${pkg}/dist/metafile-esm.json`, typeof metafile === "string" ? metafile : JSON.stringify(metafile))
}

test("the loader reads every package's metafiles and skips the ones it cannot trust", () => {
  const root = repo()
  writeBuild(root, "shared", ESM)
  writeBuild(root, "prompts", "{ not json")
  writeBuild(root, "client", { outputs: "nope" })
  write(root, "packages/render-rules/dist/index.js", "") // built without a metafile
  write(root, "packages/remotion/package.json", "{}") // nothing built at all
  // a listed output that is not on disk: the dist is not the build the metafile describes
  writeBuild(root, "picker-ui", ESM, ["dist/a.js"])
  const loaded = loadPackageChunks(root)
  assert.deepEqual(Object.keys(loaded).sort(), [SHARED])
  assert.deepEqual(pick(["packages/shared/src/c.ts"], loaded), [usesC.file, usesSrc.file].sort())
})

test("the loader merges metafile-cjs.json with metafile-esm.json", () => {
  const root = repo()
  writeBuild(root, "shared", ESM)
  write(root, "packages/shared/dist/a.cjs", "")
  write(root, "packages/shared/dist/metafile-cjs.json", JSON.stringify(CJS))
  assert.ok(pick(["packages/shared/src/shared.ts"], loadPackageChunks(root), [...all, usesCjs]).includes(usesCjs.file))
  // an unreadable cjs metafile spoils the package: both formats or neither
  write(root, "packages/shared/dist/metafile-cjs.json", "[")
  assert.deepEqual(loadPackageChunks(root), {})
})

test("the loader rejects a metafile older than an output it lists (a later build without a metafile)", () => {
  const root = repo()
  writeBuild(root, "shared", ESM)
  const old = new Date(Date.now() - 60_000)
  utimesSync(path.join(root, "packages/shared/dist/metafile-esm.json"), old, old)
  assert.deepEqual(loadPackageChunks(root), {})
})

test("the loader returns nothing for a repo without packages", () => {
  assert.deepEqual(loadPackageChunks(repo()), {})
})

// --- inputs esbuild leaves out of an output's own list ----------------------

// The metafile tsup 8.5.1 wrote (treeshake, splitting off, esm) for:
//   src/x.ts  export enum E { B = 7 }; export function sideA() { return Object.values(E) }
//   src/a.ts  import { sideA } from "./x"; export const a = sideA()
//   src/b.ts  import { E } from "./x"; export const b = E.B + 1
// dist/b.js is `var b = 7 /* B */ + 1;` — x.ts was INLINED into it, so b's
// output lists only src/b.ts. Changing B = 7 to 8 still changes dist/b.js.
const INLINED = {
  inputs: {
    "src/x.ts": { bytes: 76, imports: [], format: "esm" },
    "src/a.ts": { bytes: 53, imports: [{ path: "src/x.ts", kind: "import-statement", original: "./x" }], format: "esm" },
    "src/b.ts": { bytes: 49, imports: [{ path: "src/x.ts", kind: "import-statement", original: "./x" }], format: "esm" },
  },
  outputs: {
    "dist/a.js": { imports: [], exports: ["a"], entryPoint: "src/a.ts", inputs: { "src/x.ts": { bytesInOutput: 134 }, "src/a.ts": { bytesInOutput: 17 } }, bytes: 192 },
    "dist/b.js": { imports: [], exports: ["b"], entryPoint: "src/b.ts", inputs: { "src/b.ts": { bytesInOutput: 23 } }, bytes: 51 },
  },
}
const CLIENT = "packages/client/"
const loadsA = T("frontend/src/__tests__/loads-a.test.ts", ["packages/client/dist/a.js"])
const loadsB = T("frontend/src/__tests__/loads-b.test.ts", ["packages/client/dist/b.js"])
const clientChunks = (...metafiles) => ({ [CLIENT]: chunkMapFromMetafiles("packages/client", metafiles) })

test("a file inlined into an output it is not listed in (a TS enum) selects that output's consumers too", () => {
  assert.deepEqual(pick(["packages/client/src/x.ts"], clientChunks(INLINED), [loadsA, loadsB, unrelated]), [loadsA.file, loadsB.file].sort())
  // b's own source still narrows to b
  assert.deepEqual(pick(["packages/client/src/b.ts"], clientChunks(INLINED), [loadsA, loadsB, unrelated]), [loadsB.file])
})

test("an input inlined through a chain (x ← y ← b) still reaches b", () => {
  const chain = {
    inputs: {
      ...INLINED.inputs,
      "src/y.ts": { bytes: 30, imports: [{ path: "src/x.ts", kind: "import-statement", original: "./x" }], format: "esm" },
      "src/b.ts": { bytes: 49, imports: [{ path: "src/y.ts", kind: "import-statement", original: "./y" }], format: "esm" },
    },
    outputs: INLINED.outputs,
  }
  assert.deepEqual(pick(["packages/client/src/x.ts"], clientChunks(chain), [loadsA, loadsB, unrelated]), [loadsA.file, loadsB.file].sort())
  assert.deepEqual(pick(["packages/client/src/y.ts"], clientChunks(chain), [loadsA, loadsB, unrelated]), [loadsB.file])
})

test("an input tree-shaken out of every output selects the consumers of the outputs whose inputs import it", () => {
  const shaken = {
    inputs: {
      ...INLINED.inputs,
      "src/dead.ts": { bytes: 20, imports: [], format: "esm" },
      "src/b.ts": { bytes: 49, imports: [{ path: "src/x.ts", kind: "import-statement", original: "./x" }, { path: "src/dead.ts", kind: "import-statement", original: "./dead" }], format: "esm" },
    },
    outputs: INLINED.outputs,
  }
  // a change can bring dead.ts back into b (a new top-level side effect)
  assert.deepEqual(pick(["packages/client/src/dead.ts"], clientChunks(shaken), [loadsA, loadsB, unrelated]), [loadsB.file])
})

test("an import cycle in the input graph terminates", () => {
  const cyclic = {
    inputs: {
      "src/x.ts": { bytes: 10, imports: [{ path: "src/b.ts", kind: "import-statement", original: "./b" }], format: "esm" },
      "src/a.ts": INLINED.inputs["src/a.ts"],
      "src/b.ts": INLINED.inputs["src/b.ts"],
    },
    outputs: INLINED.outputs,
  }
  assert.deepEqual(pick(["packages/client/src/x.ts"], clientChunks(cyclic), [loadsA, loadsB, unrelated]), [loadsA.file, loadsB.file].sort())
})

test("a relative import esbuild left external makes the input graph unknown → whole package", () => {
  // tsup 8.5.1 with treeshake recorded `import { sideA } from "./x"` in a module
  // that never uses it exactly like this
  const withUnused = {
    inputs: { ...INLINED.inputs, "src/unused.ts": { bytes: 47, imports: [{ path: "./x", kind: "import-statement", external: true }], format: "esm" } },
    outputs: { ...INLINED.outputs, "dist/unused.js": { imports: [], exports: ["u"], entryPoint: "src/unused.ts", inputs: { "src/unused.ts": { bytesInOutput: 11 } }, bytes: 44 } },
  }
  assert.equal(chunkMapFromMetafiles("packages/client", [withUnused]), null)
  for (const spec of ["../x", "/abs/x.js", "#internal", "~/x", "@/lib/x"]) {
    const m = { inputs: { "src/a.ts": { bytes: 1, imports: [{ path: spec, kind: "import-statement", external: true }] } }, outputs: {} }
    assert.equal(chunkMapFromMetafiles("packages/client", [m]), null, spec)
  }
  // a package left external is not a file of this package
  for (const spec of ["react", "@nodaro/shared", "lodash/fp", "node:fs", "@supabase/supabase-js"]) {
    const m = { inputs: { "src/a.ts": { bytes: 1, imports: [{ path: spec, kind: "import-statement", external: true }] } }, outputs: {} }
    assert.notEqual(chunkMapFromMetafiles("packages/client", [m]), null, spec)
  }
  const loadsUnused = T("frontend/src/__tests__/loads-unused.test.ts", ["packages/client/dist/unused.js"])
  assert.deepEqual(pick(["packages/client/src/x.ts"], { [CLIENT]: chunkMapFromMetafiles("packages/client", [withUnused]) }, [loadsA, loadsB, loadsUnused, unrelated]),
    [loadsA.file, loadsB.file, loadsUnused.file].sort())
})

test("an edge to a file the metafile does not describe, or an output built from one → whole package", () => {
  const undescribedEdge = { inputs: { ...INLINED.inputs, "src/b.ts": { bytes: 49, imports: [{ path: "src/ghost.ts", kind: "import-statement", original: "./ghost" }] } }, outputs: INLINED.outputs }
  assert.equal(chunkMapFromMetafiles("packages/client", [undescribedEdge]), null)
  const undescribedInput = { inputs: INLINED.inputs, outputs: { ...INLINED.outputs, "dist/c.js": { imports: [], inputs: { "src/c.ts": { bytesInOutput: 3 } }, bytes: 3 } } }
  assert.equal(chunkMapFromMetafiles("packages/client", [undescribedInput]), null)
})

test("a metafile with no input graph → whole package", () => {
  assert.equal(chunkMapFromMetafiles("packages/client", [{ outputs: INLINED.outputs }]), null)
  assert.equal(chunkMapFromMetafiles("packages/client", [INLINED, { outputs: INLINED.outputs }]), null)
})
