// tools/__tests__/test-select-source-memo.test.mjs
// The graph's per-source memo (tools/test-select/source-memo.mjs). graph.mjs
// summarizes every test against every module it loads; the parsers it runs on
// each module's text are memoised per distinct source, so N tests that share M
// modules parse those modules M times, not N×M. That re-parsing is what made
// the pass cache's plan step (which builds the graph on dev's post-merge runs)
// outgrow its 5-minute timeout. Two promises are held here: the memo never
// changes a summary, and it really is once per source.
import { test } from "node:test"
import assert from "node:assert/strict"
import { summarizeTest } from "../test-select/test-node.mjs"
import { collectRegistries, namesUsed } from "../test-select/registry.mjs"
import { isScanner, parseAnnotations, parseReads, parseRegistryAnnotations } from "../test-select/annotations.mjs"
import { importedNames } from "../test-select/package-symbols.mjs"
import { MAX_ENTRIES, memoBySource, memoCounters } from "../test-select/source-memo.mjs"

// A tree with an aggregate, so every test below takes the registry path
// (enumeratorsIn over its product modules — the most expensive pass).
const R = "frontend/src/nodes/_generated/executors.ts"
const U1 = "frontend/src/nodes/u1/exec.ts"
const C = "frontend/src/lib/composer.ts"
const E = "frontend/src/lib/enumerator.ts"
const L = "frontend/src/lib/lookup.ts"
const HELPER = "frontend/src/test/read-helper.ts"
const PRODUCT_TWIN = "frontend/src/lib/read-helper.ts"
// The same text at a test-side helper path and at a product path: a helper's
// reads are the test's (watches), a product module's are `@reads`. A memo keyed
// on the source must not blur the two.
const READER = "// @test-watches docs/**/*.md\n// @reads supabase/migrations/*.sql\nimport { readFileSync } from \"node:fs\"\nexport const load = (p) => readFileSync(p)\n"
const UNDECLARED = "import { readdirSync } from \"node:fs\"\nexport const list = () => readdirSync(\".\")\n"
const SRC = {
  [R]: '// @registry frontend/src/nodes/*/exec.ts\n// @registry-exports executors: UNIT_EXECUTORS\nimport { executor as unit_u1 } from "../u1/exec" // unit:u1\nexport const UNIT_EXECUTORS = {\n  "u1": unit_u1, // unit:u1\n} as const\n',
  [U1]: "export const executor = { run: () => 1 }\n",
  [C]: '// @registry-exports executors: ALL_EXECUTORS\nimport { UNIT_EXECUTORS } from "../nodes/_generated/executors"\nexport const ALL_EXECUTORS = { ...UNIT_EXECUTORS }\n',
  [E]: 'import { ALL_EXECUTORS } from "./composer"\nconst { thing, ...rest } = await import("./other")\nexport const count = Object.keys(ALL_EXECUTORS).length\n',
  [L]: '// @registry-lookup runs the one executor it is given a type for\nimport { ALL_EXECUTORS } from "./composer"\nexport const run = (t) => ALL_EXECUTORS[t]\n',
  [HELPER]: READER,
  [PRODUCT_TWIN]: READER,
}
const info = collectRegistries(Object.entries(SRC).map(([path, source]) => ({ path, source })), [C])
const M_SHARED = 30
// Named to sort before the enumerator: the registry pass asks about each of
// them (none names a registry export) before it finds the one that does.
const sharedPaths = Array.from({ length: M_SHARED }, (_, i) => `frontend/src/lib/a-shared-${i}.ts`)
const sharedSource = (i) => i % 7 === 0
  ? UNDECLARED.replace("list", `list${i}`)
  : `import { thing${i} } from "./things"\n// @reads-none module ${i} reads nothing\nexport const v${i} = thing${i}\n`

// One test's summary. `copy(text)` decides whether its modules' texts are the
// shared strings (what graph.mjs hands over: one cache for the whole run) or
// a private copy no other test has (every parse is cold).
function summarize(n, copy) {
  const deps = [R, U1, C, E, L, HELPER, PRODUCT_TWIN, ...sharedPaths.slice(0, 10 + (n % (M_SHARED - 10)))]
    .sort()
    .map((path) => ({ path, source: copy(SRC[path] ?? sharedSource(sharedPaths.indexOf(path))) }))
  const source = `import { count } from "../enumerator"\nimport { run } from "../lookup"\nrun("u${n % 2 ? 1 : 2}")\n${n % 5 === 0 ? "// @test-watches frontend/src/nodes/**\n" : ""}`
  return summarizeTest({ file: `frontend/src/lib/__tests__/t${n}.test.ts`, source, deps, registry: { info, via: new Map(), unitTypes: ["u1", "u2"] } })
}

let nonce = 0
// A trailing comment line names no annotation, binding or read: the analysis
// of the copy is the analysis of the original.
const coldCopy = (text) => `${text}\n// cold copy ${++nonce}\n`

test("a memoised summary equals the summary of the same tree parsed cold", () => {
  const N = 24
  const warm = Array.from({ length: N }, (_, n) => summarize(n, (t) => t))
  const warmAgain = Array.from({ length: N }, (_, n) => summarize(n, (t) => t))
  const cold = Array.from({ length: N }, (_, n) => summarize(n, coldCopy))
  assert.deepEqual(warmAgain, warm)
  assert.deepEqual(cold, warm)
  // The fixture exercises what it claims to: the registry pass ran, and the
  // twin source was read as a helper's watches AND as a product's @reads.
  assert.ok(warm.every((t) => Object.keys(t.enumerates).length > 0), "every test reaches the aggregate")
  assert.ok(warm[0].watches.includes("docs/**/*.md"))
  assert.ok(warm[0].reads.includes("supabase/migrations/*.sql"))
  assert.equal(warm[0].undeclaredReader, "frontend/src/lib/a-shared-0.ts")
})

test("N tests sharing M modules parse each module once, not once per test", () => {
  const N = 40
  const names = ["bindingsOf", "nameVerdicts", "importedNames", "parseAnnotations", "parseReads", "isScanner", "parseRegistryAnnotations"]
  const before = new Map(names.map((name) => [name, { ...memoCounters.get(name) }]))
  // Fresh texts for this test alone, so earlier tests' cache entries do not
  // hide a miss.
  const tag = `// run ${++nonce}\n`
  const fresh = new Map()
  const shared = (text) => {
    if (!fresh.has(text)) fresh.set(text, `${text}${tag}`)
    return fresh.get(text)
  }
  for (let n = 0; n < N; n++) summarize(n, shared)
  // Every distinct text this run could have parsed: the shared modules plus
  // each test's own file (at most N distinct ones).
  const distinct = fresh.size + N
  for (const name of names) {
    const { calls, misses } = memoCounters.get(name)
    const asked = calls - before.get(name).calls
    const computed = misses - before.get(name).misses
    assert.ok(computed <= distinct, `${name} computed ${computed} times for ${distinct} distinct sources (asked ${asked})`)
  }
  // The guard means something: the registry pass (one verdict lookup per
  // module per registry, per test) is asked far more often than it computes.
  const v = memoCounters.get("nameVerdicts")
  const asked = v.calls - before.get("nameVerdicts").calls
  const computed = v.misses - before.get("nameVerdicts").misses
  assert.ok(asked > 5 * computed, `nameVerdicts asked ${asked} times, computed ${computed}`)
})

test("a cached parse is frozen: a caller cannot change another caller's answer", () => {
  const source = "// @test-watches a/**\n// @reads b/**\n// @registry c/*.ts\n"
  for (const value of [parseAnnotations(source), parseReads(source), parseRegistryAnnotations(source)]) {
    assert.ok(Object.isFrozen(value))
    for (const v of Object.values(value)) if (v && typeof v === "object") assert.ok(Object.isFrozen(v))
  }
  assert.throws(() => parseAnnotations(source).watches.push("x/**"), TypeError)
  assert.deepEqual(parseAnnotations(source).watches, ["a/**"])
  // Not a pure function of the text alone? Then it is not memoised by text:
  // the same source still answers per the names asked about.
  assert.deepEqual([...namesUsed('import { A } from "x"\n', new Set(["A"]))], ["A"])
  assert.deepEqual([...namesUsed('import { A } from "x"\n', new Set(["B"]))], [])
  // A Set cannot be frozen: importedNames hands each caller its own copy.
  const shared = 'import { a } from "@nodaro/shared"\n'
  importedNames(shared).add("poisoned")
  assert.deepEqual([...importedNames(shared)], ["a"])
  assert.equal(isScanner("readFileSync(p)"), true)
  assert.equal(isScanner("readFileSync"), false)
})

test("the memo is bounded: past MAX_ENTRIES distinct sources it starts over", () => {
  let computed = 0
  const length = memoBySource("bounded-probe", (s) => { computed++; return s.length })
  for (let i = 0; i <= MAX_ENTRIES; i++) length(`s${i}`)
  assert.equal(computed, MAX_ENTRIES + 1)
  length("s1") // dropped when the cache started over
  assert.equal(computed, MAX_ENTRIES + 2)
  length(`s${MAX_ENTRIES}`) // kept: the newest entry survives the reset
  assert.equal(computed, MAX_ENTRIES + 2)
})
