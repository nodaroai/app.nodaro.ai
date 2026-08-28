import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { checkManifests, satisfies } from "../check-published-manifests.mjs"

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "check-published-manifests.mjs")

const manifest = (name, version, extra = {}) => ({ file: `packages/${name.replace("@nodaro/", "")}/package.json`, json: { name, version, ...extra } })

test("satisfies: caret / tilde / exact, including the major-0 caret rule", () => {
  assert.equal(satisfies("2.11.0", "^2.11.0"), true)
  assert.equal(satisfies("2.12.3", "^2.11.0"), true)
  assert.equal(satisfies("3.0.0", "^2.11.0"), false)
  assert.equal(satisfies("2.10.9", "^2.11.0"), false)
  assert.equal(satisfies("2.11.7", "~2.11.0"), true)
  assert.equal(satisfies("2.12.0", "~2.11.0"), false)
  assert.equal(satisfies("2.11.0", "2.11.0"), true)
  assert.equal(satisfies("2.11.1", "2.11.0"), false)
  assert.equal(satisfies("0.2.5", "^0.2.0"), true)
  assert.equal(satisfies("0.3.0", "^0.2.0"), false)
  assert.equal(satisfies("2.11.0", "*"), false)
})

test("a wildcard on a published package's @nodaro/* dependency is a violation", () => {
  const v = checkManifests([
    manifest("@nodaro/prompts", "1.8.0", { dependencies: { "@nodaro/shared": "*" } }),
    manifest("@nodaro/shared", "2.11.0"),
  ])
  assert.equal(v.length, 1)
  assert.match(v[0], /packages\/prompts\/package\.json: dependencies\["@nodaro\/shared"\] = "\*"/)
})

test("workspace:, file:, link:, tags and compound ranges are violations too", () => {
  for (const range of ["workspace:*", "workspace:^", "file:../shared", "link:../shared", "latest", ">=2.0.0 <3.0.0", "2.x"]) {
    const v = checkManifests([
      manifest("@nodaro/sdk", "1.20.0", { dependencies: { "@nodaro/shared": range } }),
      manifest("@nodaro/shared", "2.11.0"),
    ])
    assert.equal(v.length, 1, `range ${range} should be rejected`)
  }
})

test("a real range that the sibling's current version does not satisfy is a violation", () => {
  const v = checkManifests([
    manifest("@nodaro/sdk", "1.20.0", { dependencies: { "@nodaro/shared": "^2.4.0" } }),
    manifest("@nodaro/shared", "3.0.0"),
  ])
  assert.equal(v.length, 1)
  assert.match(v[0], /does not match the workspace sibling's current version 3\.0\.0/)
})

test("private packages, non-@nodaro deps and peer/optional fields are handled", () => {
  const v = checkManifests([
    manifest("@nodaro/picker-ui", "0.1.1", { private: true, dependencies: { "@nodaro/shared": "*" } }),
    manifest("@nodaro/cli", "1.12.0", {
      dependencies: { commander: "^12.1.0", "@nodaro/sdk": "^1.20.0" },
      peerDependencies: { "@nodaro/shared": "*" },
    }),
    manifest("@nodaro/sdk", "1.20.0", { dependencies: { "@nodaro/shared": "^2.11.0" } }),
    manifest("@nodaro/shared", "2.11.0"),
  ])
  assert.equal(v.length, 1)
  assert.match(v[0], /peerDependencies\["@nodaro\/shared"\] = "\*"/)
})

test("CLI: exits 1 on a wildcard fixture and 0 on a clean one", () => {
  const root = mkdtempSync(join(tmpdir(), "published-manifests-"))
  mkdirSync(join(root, "packages", "a"), { recursive: true })
  mkdirSync(join(root, "packages", "b"), { recursive: true })
  writeFileSync(join(root, "packages", "b", "package.json"), JSON.stringify({ name: "@nodaro/b", version: "2.0.0" }))
  writeFileSync(join(root, "packages", "a", "package.json"), JSON.stringify({ name: "@nodaro/a", version: "1.0.0", dependencies: { "@nodaro/b": "*" } }))
  const bad = spawnSync(process.execPath, [ENTRY], { cwd: root, encoding: "utf8" })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /dependencies\["@nodaro\/b"\] = "\*"/)

  writeFileSync(join(root, "packages", "a", "package.json"), JSON.stringify({ name: "@nodaro/a", version: "1.0.0", dependencies: { "@nodaro/b": "^2.0.0" } }))
  const good = spawnSync(process.execPath, [ENTRY], { cwd: root, encoding: "utf8" })
  assert.equal(good.status, 0, good.stderr)
  assert.match(good.stdout, /OK: 2 published package manifest\(s\)/)
})

test("the real workspace passes", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
  const res = spawnSync(process.execPath, [ENTRY], { cwd: repoRoot, encoding: "utf8" })
  assert.equal(res.status, 0, res.stderr)
})
