// tools/__tests__/reads-guard.test.mjs
// Product code that reads repo files at run time (skills markdown, docs,
// migrations, templates) is invisible to the import graph. It declares what it
// reads — `// @reads <glob>` — or that its reads never touch the repo —
// `// @reads-none <reason>` — so CI selects exactly the tests that reach it.
// Undeclared readers make every non-code change select their tests; the ones
// that predate the rule are the burn-down in
// tools/test-select/undeclared-readers.json — it only shrinks.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { isScanner, parseReads } from "../test-select/annotations.mjs"
import { matchesAny } from "../test-select/glob.mjs"
import { TEST_FILE, TEST_SIDE_HELPER } from "../test-select/test-node.mjs"

const root = new URL("../../", import.meta.url)
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
// Every non-test module under frontend/ or backend/, not only src/: tests also
// import file-reading code from backend/scripts/** (gen-skills, check-surfaces).
const productModules = tracked.filter((f) => /^(frontend|backend)\/.*\.[cm]?[jt]sx?$/.test(f)
  && !/(?:^|\/)(?:node_modules|dist)\//.test(f)
  && !TEST_FILE.test(f) && !TEST_SIDE_HELPER.test(f))
const read = (f) => readFileSync(new URL(f, root), "utf8")
const baseline = JSON.parse(readFileSync(new URL("tools/test-select/undeclared-readers.json", root), "utf8"))

test("a NEW product module that reads files declares @reads or @reads-none; the known list only shrinks", () => {
  const now = productModules.filter((f) => {
    const src = read(f)
    const r = parseReads(src)
    return isScanner(src) && r.reads.length === 0 && !r.readsNone
  })
  const known = new Set(baseline)
  assert.deepEqual(now.filter((f) => !known.has(f)), [],
    "These modules read files at run time but declare neither `// @reads <glob>` (the repo files they read) nor `// @reads-none <reason>`. Without it every non-code change in a PR runs the tests that reach them. See tools/test-select/README.md.")
  const current = new Set(now)
  assert.deepEqual(baseline.filter((f) => !current.has(f)), [],
    "These are declared or gone — remove them from tools/test-select/undeclared-readers.json (the list only shrinks).")
})

test("every @reads glob matches at least one tracked file (a typo would never select its tests)", () => {
  const dead = productModules.flatMap((f) => parseReads(read(f)).reads
    .filter((g) => !tracked.some((p) => matchesAny(p, [g])))
    .map((g) => `${f}: ${g}`))
  assert.deepEqual(dead, [])
})
