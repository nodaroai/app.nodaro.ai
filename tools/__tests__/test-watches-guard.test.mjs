// tools/__tests__/test-watches-guard.test.mjs
// A test that reads files at run time is invisible to the import graph. It
// must say what it reads (`// @test-watches <glob>`) or that it depends on
// everything (`// @test-always <reason>`); otherwise the selection engine has
// to run it on every PR. A test-side helper (a non-test file under
// __tests__/, src/test/, test-utils/ or fixtures/) is part of every test that
// imports it, so the same applies to it — unless it reads only the paths its
// caller passes (`// @test-reads-for-caller <reason>`), which puts the
// declaration on the importing test (and on any helper that imports it: that
// helper is a caller too). The ones that predate the rule are
// the burn-down in tools/test-select/untagged-scanners.json — it only shrinks.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { parseAnnotations } from "../test-select/annotations.mjs"
import { matchesAny } from "../test-select/glob.mjs"
import { TEST_FILE, TEST_SIDE_HELPER, helpersImportingPassThrough, undeclaredTestReader } from "../test-select/test-node.mjs"

const root = new URL("../../", import.meta.url)
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
const testFiles = tracked.filter((f) => /^(frontend|backend)\/src\/.*\.[cm]?[jt]sx?$/.test(f)
  && (TEST_FILE.test(f) || TEST_SIDE_HELPER.test(f)))
const read = (f) => readFileSync(new URL(f, root), "utf8")
const baseline = JSON.parse(readFileSync(new URL("tools/test-select/untagged-scanners.json", root), "utf8"))

function untagged() {
  return testFiles.filter((f) => undeclaredTestReader(f, read(f)))
}

test("a NEW test or test helper that reads files declares @test-watches, @test-always or @test-reads-none; the known list only shrinks", () => {
  const now = untagged()
  const known = new Set(baseline)
  assert.deepEqual(now.filter((f) => !known.has(f)), [],
    "These tests and test helpers read files at run time but declare neither `// @test-watches <glob>` nor `// @test-always <reason>` nor `// @test-reads-none <reason>` (nor, on a helper that reads only what its caller passes, `// @test-reads-for-caller <reason>`) — without it they (and every test importing the helper) run on every PR. See tools/test-select/README.md.")
  const current = new Set(now)
  assert.deepEqual(baseline.filter((f) => !current.has(f)), [],
    "These are tagged or gone — remove them from tools/test-select/untagged-scanners.json (the list only shrinks).")
})

test("every @test-watches glob in a test or test helper matches at least one tracked file (a typo would never select its test)", () => {
  const dead = testFiles.flatMap((f) => parseAnnotations(read(f)).watches
    .filter((g) => !tracked.some((p) => matchesAny(p, [g])))
    .map((g) => `${f}: ${g}`))
  assert.deepEqual(dead, [])
})

test("a test helper that imports a @test-reads-for-caller module carries the marker or declares @test-watches / @test-always (never @test-reads-none)", () => {
  assert.deepEqual(helpersImportingPassThrough(testFiles.map((f) => ({ path: f, source: read(f) }))), [],
    "These test helpers hand paths to a module that reads only what its caller passes — what they ask it to read is invisible to the tests that import them. Add `// @test-reads-for-caller <reason>` (the tests importing them then declare) or `// @test-watches <glob>` / `// @test-always <reason>`. `@test-reads-none` does not count here: what such a module reads is what the helper hands it, so a helper must name it or pass the declaration to its caller. See tools/test-select/README.md.")
})
