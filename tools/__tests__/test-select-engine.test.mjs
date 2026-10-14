// tools/__tests__/test-select-engine.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { runSelection } from "../test-select/engine.mjs"

const tests = [{ file: "frontend/src/a.test.ts", deps: ["frontend/src/a.ts"], watches: [], always: null, scanner: false }]

test("the engine selects through the graph it is given", async () => {
  const r = await runSelection({ project: "frontend", readChanges: () => [{ status: "M", path: "frontend/src/a.ts" }], loadGraph: async () => tests })
  assert.equal(r.mode, "affected")
  assert.equal(r.total, 1)
})

test("REVIEW FOCUS 3: a graph that cannot be built (e.g. a Vitest API change) means a full run, with the reason", async () => {
  const r = await runSelection({ project: "frontend", readChanges: () => [], loadGraph: async () => { throw new Error("vitest.specifications.getTestDependencies is unavailable") } })
  assert.equal(r.mode, "full")
  assert.match(r.reason, /could not decide.*getTestDependencies is unavailable/)
})

test("a change list that cannot be read means a full run", async () => {
  const r = await runSelection({ project: "frontend", readChanges: () => { throw new Error("gh: HTTP 502") }, loadGraph: async () => tests })
  assert.equal(r.mode, "full")
  assert.match(r.reason, /HTTP 502/)
})

test("the change list may come asynchronously (the GitHub API): it is awaited, and its rejection means a full run", async () => {
  const ok = await runSelection({ project: "frontend", readChanges: async () => [{ status: "M", path: "frontend/src/a.ts" }], loadGraph: async () => tests })
  assert.equal(ok.mode, "affected")
  const bad = await runSelection({ project: "frontend", readChanges: async () => { throw new Error("GitHub API: HTTP 502") }, loadGraph: async () => tests })
  assert.equal(bad.mode, "full")
  assert.match(bad.reason, /HTTP 502/)
})

// Without built packages/*/dist Vitest's walk skips every workspace-package
// edge (it drops deps that do not exist on disk), so a packages/shared/src
// change would select nothing. Only the packages the project actually depends
// on count: packages/cli's dist is never built by build:packages nor shipped
// in the CI artifact, and demanding it would make every selection a full run.
test("missing builds of the packages a project depends on are reported; others are not", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const path = (await import("node:path")).default
  const { missingPackageBuilds } = await import("../test-select/graph.mjs")
  const root = mkdtempSync(path.join(tmpdir(), "test-select-pkgs-"))
  const pkg = (dir, json, built = []) => {
    mkdirSync(path.join(root, dir), { recursive: true })
    writeFileSync(path.join(root, dir, "package.json"), JSON.stringify(json))
    for (const f of built) {
      mkdirSync(path.dirname(path.join(root, dir, f)), { recursive: true })
      writeFileSync(path.join(root, dir, f), "")
    }
  }
  pkg("frontend", { dependencies: { "@nodaro/sdk": "*", react: "*" } })
  // declared, dist built
  pkg("packages/client", { name: "@nodaro/sdk", main: "./dist/index.cjs", module: "./dist/index.js", dependencies: { "@nodaro/prompts": "*" } }, ["dist/index.cjs", "dist/index.js"])
  // transitive only, module missing
  pkg("packages/prompts", { name: "@nodaro/prompts", main: "./dist/index.cjs", module: "./dist/index.js", dependencies: { "@nodaro/shared": "*" } }, ["dist/index.cjs"])
  // transitive of a transitive, nothing built
  pkg("packages/shared", { name: "@nodaro/shared", main: "./dist/index.cjs" })
  // undeclared, nothing built (the cli case)
  pkg("packages/cli", { name: "@nodaro/cli", main: "./dist/index.js", dependencies: { "@nodaro/sdk": "*" } })
  // depended on, but its entry is source, not a build
  pkg("packages/remotion", { name: "@nodaro/remotion", main: "src/index.ts" })
  pkg("backend", { devDependencies: { "@nodaro/remotion": "*" } })

  assert.deepEqual(missingPackageBuilds(root, "frontend"), ["packages/prompts/dist/index.js", "packages/shared/dist/index.cjs"])
  assert.deepEqual(missingPackageBuilds(root, "backend"), [])
})

test("package build metafiles narrow a package change; a loader that fails falls back to the whole-package rule, not a full run", async () => {
  const graph = async () => [
    { file: "frontend/src/a.test.ts", deps: ["packages/shared/dist/a.js"], watches: [], always: null, scanner: false },
    { file: "frontend/src/b.test.ts", deps: ["packages/shared/dist/b.js"], watches: [], always: null, scanner: false },
  ]
  const { chunkMapFromMetafiles } = await import("../test-select/package-chunks.mjs")
  const meta = {
    inputs: { "src/a.ts": { bytes: 1, imports: [] }, "src/b.ts": { bytes: 1, imports: [] } },
    outputs: { "dist/a.js": { inputs: { "src/a.ts": {} }, imports: [] }, "dist/b.js": { inputs: { "src/b.ts": {} }, imports: [] } },
  }
  const readChanges = () => [{ status: "M", path: "packages/shared/src/a.ts" }]
  const precise = await runSelection({ project: "frontend", readChanges, loadGraph: graph,
    loadPackageChunks: async () => ({ "packages/shared/": chunkMapFromMetafiles("packages/shared", [meta]) }) })
  assert.deepEqual(precise.files.map((f) => f.file), ["frontend/src/a.test.ts"])
  const failed = await runSelection({ project: "frontend", readChanges, loadGraph: graph, loadPackageChunks: async () => { throw new Error("EACCES") } })
  assert.equal(failed.mode, "affected")
  assert.deepEqual(failed.files.map((f) => f.file), ["frontend/src/a.test.ts", "frontend/src/b.test.ts"])
})
