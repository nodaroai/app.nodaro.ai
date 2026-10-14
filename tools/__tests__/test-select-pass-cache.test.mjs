// tools/__tests__/test-select-pass-cache.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isoWeek, setupImports, environmentFiles, environmentKey, mergePassed, MAX_RECORDED, planShard, provenKeys, shardOf, testKey, uncacheableReason,
} from "../test-select/pass-cache.mjs"

const contents = new Map(Object.entries({
  "frontend/src/a.test.ts": "a", "frontend/src/a.ts": "A", "frontend/src/b.ts": "B",
  "backend/skills/x.md": "x", "packages/shared/dist/index.js": "S",
}))
const hash = (f) => contents.get(f) ?? "missing"
const tracked = [...contents.keys(), "frontend/src/test/setup.ts", "package-lock.json", "docs/readme.md"]
const base = { file: "frontend/src/a.test.ts", deps: ["frontend/src/a.ts", "packages/shared/dist/index.js"], watches: [], always: null, scanner: false, reads: [], undeclaredReader: null }
const key = (t, over = {}) => testKey(t, { hash: over.hash ?? hash, trackedFiles: tracked, environment: over.environment ?? "env", sharedWorker: over.sharedWorker })

test("the key changes when the test, any module it loads, a file it declares, or the environment changes", () => {
  const k = key(base)
  assert.equal(k, key(base))
  assert.match(k, /^[0-9a-f]{32}$/)
  const changed = (f, v) => (p) => (p === f ? v : hash(p))
  assert.notEqual(key(base, { hash: changed("frontend/src/a.test.ts", "a2") }), k)
  assert.notEqual(key(base, { hash: changed("frontend/src/a.ts", "A2") }), k)
  assert.notEqual(key(base, { hash: changed("packages/shared/dist/index.js", "S2") }), k, "a rebuilt package dist")
  assert.notEqual(key(base, { environment: "env2" }), k)
  assert.equal(key(base, { hash: changed("frontend/src/b.ts", "B2") }), k, "a module it does not load")
  const watching = { ...base, watches: ["backend/skills/*.md"] }
  assert.notEqual(key(watching, { hash: changed("backend/skills/x.md", "x2") }), key(watching))
  const reading = { ...base, reads: ["backend/skills/**"] }
  assert.notEqual(key(reading, { hash: changed("backend/skills/x.md", "x2") }), key(reading))
  assert.notEqual(key(base, { hash: changed("frontend/src/__snapshots__/a.test.ts.snap", "snap") }), k, "its snapshot")
})

test("a test that reads undeclared files, is always-run or shares a worker is never cached", () => {
  assert.equal(key({ ...base, always: "scans everything" }), null)
  assert.equal(key({ ...base, scanner: true }), null)
  assert.equal(key({ ...base, undeclaredReader: "frontend/src/reader.ts" }), null)
  assert.equal(key(base, { sharedWorker: new Set([base.file]) }), null)
  assert.match(uncacheableReason({ ...base, scanner: true }), /does not declare/)
  assert.equal(uncacheableReason(base), null)
})

test("the environment covers the global triggers and undeclared test data, nothing else", () => {
  const files = environmentFiles(["package-lock.json", "frontend/src/test/setup.ts", "frontend/vitest.config.ts", "tools/test-select/select.mjs",
    "frontend/src/lib/__tests__/fixtures/x.json", "frontend/src/lib/__tests__/x.test.ts", "frontend/src/a.ts", "docs/readme.md"])
  assert.deepEqual(files, ["frontend/src/lib/__tests__/fixtures/x.json", "frontend/src/test/setup.ts", "frontend/vitest.config.ts", "package-lock.json", "tools/test-select/select.mjs"])
  assert.notEqual(environmentKey({ files, hash }), environmentKey({ files, hash, extra: ["node:v23"] }))
})

test("shards partition every candidate exactly once, whatever each shard restored", () => {
  const candidates = Array.from({ length: 200 }, (_, i) => `frontend/src/t${i}.test.ts`)
  const keys = new Map(candidates.map((f, i) => [f, `k${i}`]))
  const seen = []
  for (let shard = 1; shard <= 4; shard++) {
    // each shard restored a different cache: shard 2 knows nothing
    const passed = new Set(shard === 2 ? [] : ["k1", "k2", "k3"])
    const { run, skipped } = planShard({ candidates, shard, shards: 4, keys, passed })
    seen.push(...run, ...skipped)
    for (const f of [...run, ...skipped]) assert.equal(shardOf(f, 4), shard)
  }
  assert.deepEqual(seen.sort(), [...candidates].sort())
})

test("a file is skipped only when its key passed; an uncacheable file always runs", () => {
  const candidates = ["frontend/src/a.test.ts", "frontend/src/b.test.ts"]
  const keys = new Map([["frontend/src/a.test.ts", "ka"], ["frontend/src/b.test.ts", null]])
  const { run, skipped } = planShard({ candidates, shard: 1, shards: 1, keys, passed: new Set(["ka", "kb"]) })
  assert.deepEqual(skipped, ["frontend/src/a.test.ts"])
  assert.deepEqual(run, ["frontend/src/b.test.ts"])
})

test("only files that ran and passed are recorded, and nothing after an unhandled error or without a report", () => {
  const keys = new Map([["frontend/src/a.test.ts", "ka"], ["frontend/src/b.test.ts", "kb"], ["frontend/src/c.test.ts", null]])
  const ok = [{ status: "passed" }]
  const report = { testResults: [
    { name: "/r/frontend/src/a.test.ts", status: "passed", assertionResults: ok }, { name: "/r/frontend/src/b.test.ts", status: "failed", assertionResults: [{ status: "failed" }] },
    { name: "/r/frontend/src/c.test.ts", status: "passed", assertionResults: ok },
  ] }
  const toRepoPath = (n) => n.replace("/r/", "")
  assert.deepEqual(provenKeys({ report, keys, unhandled: false, toRepoPath }), ["ka"])
  assert.deepEqual(provenKeys({ report, keys, unhandled: true, toRepoPath }), [])
  assert.deepEqual(provenKeys({ report: null, keys, unhandled: false, toRepoPath }), [])
})

test("the recorded set keeps the newest keys first, without duplicates, capped", () => {
  assert.deepEqual(mergePassed(["a", "b"], ["c", "a"]), ["c", "a", "b"])
  const big = Array.from({ length: MAX_RECORDED + 5 }, (_, i) => `k${i}`)
  const merged = mergePassed(big, ["new"])
  assert.equal(merged.length, MAX_RECORDED)
  assert.equal(merged[0], "new")
})

test("a file with a skipped test, or a failed run that names no failing file, proves nothing", () => {
  const keys = new Map([["frontend/src/a.test.ts", "ka"], ["frontend/src/d.test.ts", "kd"]])
  const toRepoPath = (n) => n.replace("/r/", "")
  const report = { testResults: [
    { name: "/r/frontend/src/a.test.ts", status: "passed", assertionResults: [{ status: "passed" }] },
    { name: "/r/frontend/src/d.test.ts", status: "passed", assertionResults: [{ status: "passed" }, { status: "skipped" }] },
  ] }
  assert.deepEqual(provenKeys({ report, keys, unhandled: false, toRepoPath }), ["ka"])
  assert.deepEqual(provenKeys({ report, keys, unhandled: false, toRepoPath, exitCode: 1 }), [], "crashed with no failing file")
  const allSkipped = { testResults: [{ name: "/r/frontend/src/a.test.ts", status: "passed", assertionResults: [] }] }
  assert.deepEqual(provenKeys({ report: allSkipped, keys, unhandled: false, toRepoPath }), [])
})

test("an input that cannot be read makes the test uncacheable", () => {
  assert.equal(key({ ...base, deps: [...base.deps, "frontend/src/gone.ts"] }), null)
  assert.equal(key({ ...base, file: "frontend/src/gone.test.ts" }), null)
})

test("setup imports are resolved one level; the week bucket is ISO", () => {
  const src = 'import { a } from "./x"\nawait import("../ee/pipelines/llms/prompt-registry.js")\nimport "vitest"\n'
  assert.deepEqual(setupImports("backend/src/test/setup.ts", src), ["backend/src/ee/pipelines/llms/prompt-registry.ts", "backend/src/test/x"])
  assert.equal(isoWeek(new Date("2026-10-14T12:00:00Z")), "2026-W42")
  assert.equal(isoWeek(new Date("2027-01-01T00:00:00Z")), "2026-W53")
  assert.ok(environmentFiles(["frontend/src/__mocks__/x.ts", "tools/ci-runner/runner.Dockerfile"]).length === 2)
})
