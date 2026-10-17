// tools/__tests__/test-select-registry.test.mjs
// The registry rule (tools/test-select/registry.mjs, decided 2026-10-16) on a
// pure in-memory tree: an aggregate R (`executors`) with units u1 and u2, a
// helper H reachable only through u1, a composer C (pass-through), an
// enumerator E and a lookup module L. No Vitest: graph.mjs's walk is replaced
// by the adjacency map below.
import { test } from "node:test"
import assert from "node:assert/strict"
import { selectTests } from "../test-select/select.mjs"
import { summarizeTest } from "../test-select/test-node.mjs"
import { testKey } from "../test-select/pass-cache.mjs"
import {
  collectRegistries, enumeratorsIn, memberLineTypes, namesUsed, registryClosure, registryRuleMode, sideEffectsOf, typeLiteralsIn, unitOf, watchesUnits,
} from "../test-select/registry.mjs"
import { parseRegistryAnnotations } from "../test-select/annotations.mjs"

const R = "frontend/src/nodes/_generated/executors.ts"
const U1 = "frontend/src/nodes/u1/exec.ts"
const U2 = "frontend/src/nodes/u2/exec.ts"
const H = "frontend/src/lib/h.ts"
const C = "frontend/src/lib/composer.ts"
const E = "frontend/src/lib/enumerator.ts"
const L = "frontend/src/lib/lookup.ts"

const SRC = {
  [R]: '// @registry frontend/src/nodes/*/exec.ts\n// @registry-exports executors: UNIT_EXECUTORS\nimport { executor as unit_u1 } from "../u1/exec" // unit:u1\nimport { executor as unit_u2 } from "../u2/exec" // unit:u2\n\nexport const UNIT_EXECUTORS = {\n  "u1": unit_u1, // unit:u1\n  "u2": unit_u2, // unit:u2\n} as const\n',
  [U1]: 'import { help } from "../../lib/h"\nexport const executor = { run: () => help() }\n',
  [U2]: "export const executor = { run: () => 2 }\n",
  [H]: "export const help = () => 1\n",
  [C]: '// @registry-exports executors: ALL_EXECUTORS\nimport { UNIT_EXECUTORS } from "../nodes/_generated/executors"\nexport const ALL_EXECUTORS = { ...UNIT_EXECUTORS }\n',
  [E]: 'import { ALL_EXECUTORS } from "./composer"\nexport const count = Object.keys(ALL_EXECUTORS).length\n',
  [L]: '// @registry-lookup runs the one executor it is given a type for\nimport { ALL_EXECUTORS } from "./composer"\nexport const run = (t) => ALL_EXECUTORS[t]\n',
}
const IMPORTS = { [R]: [U1, U2], [U1]: [H], [U2]: [], [H]: [], [C]: [R], [E]: [C], [L]: [C] }
const info = collectRegistries(Object.entries(SRC).map(([path, source]) => ({ path, source })), [C])
const UNIT_TYPES = ["u1", "u2"]

// One test over the fixture: its deps are the full closure; its cut comes
// from registryClosure (what graph.mjs computes from the Vite walk).
function make(file, source, imports, { walker = true } = {}) {
  const adjacency = new Map(Object.entries(IMPORTS))
  adjacency.set(file, imports)
  const deps = new Set()
  const stack = [...imports]
  while (stack.length) {
    const f = stack.pop()
    if (deps.has(f)) continue
    deps.add(f)
    stack.push(...(adjacency.get(f) ?? []))
  }
  const via = walker ? registryClosure(adjacency, file, info.aggregates).via : new Map()
  return summarizeTest({
    file, source,
    deps: [...deps].sort().map((p) => ({ path: p, source: SRC[p] ?? "" })),
    registry: { info, via, unitTypes: UNIT_TYPES },
  })
}

const own = make("frontend/src/nodes/u1/__tests__/u1.test.ts", 'import { executor } from "../exec"\n', [U1])
const lookup = make("frontend/src/lib/__tests__/lookup.test.ts", 'import { run } from "../lookup"\n', [L])
const enumerating = make("frontend/src/lib/__tests__/enumerator.test.ts", 'import { count } from "../enumerator"\n', [E])
const namesU1 = make("frontend/src/lib/__tests__/names-u1.test.ts", 'import { run } from "../lookup"\nrun("u1")\n', [L])
const namesU2 = make("frontend/src/lib/__tests__/names-u2.test.ts", 'import { run } from "../lookup"\nrun("u2")\n', [L])
const burnDown = make("frontend/src/lib/__tests__/burn-down.test.ts", 'import { ALL_EXECUTORS } from "../composer"\nexpect(Object.keys(ALL_EXECUTORS))\n', [C])
const byName = make("frontend/src/lib/__tests__/by-name.test.ts", '// @test-units-by-name looks up u2 only\nimport { ALL_EXECUTORS } from "../composer"\nALL_EXECUTORS["u2"]\n', [C])
const watcher = make("frontend/src/lib/__tests__/watcher.test.ts", '// @test-watches frontend/src/nodes/**\nimport { run } from "../lookup"\n', [L])
const TESTS = [own, lookup, enumerating, namesU1, namesU2, burnDown, byName, watcher]

const M = (path, extra = {}) => ({ status: "M", path, sideEffects: false, ...extra })
const pick = (changes, registryRule = "enforce", tests = TESTS) => selectTests({ project: "frontend", changes, tests, registryRule })
const files = (sel) => sel.files.map((f) => f.file.replace(/^.*\//, ""))

test("the cut: u1, u2 and H are reached only through member edges; the composer and the aggregate are not", () => {
  assert.deepEqual(Object.keys(lookup.viaRegistry).sort(), [H, U1, U2].sort())
  assert.deepEqual(lookup.viaRegistry[H], { registries: ["executors"], units: ["u1"] })
  assert.deepEqual(lookup.viaRegistry[U2], { registries: ["executors"], units: ["u2"] })
  assert.ok(lookup.deps.includes(U1) && lookup.deps.includes(H), "deps (the pass cache key) stay the full closure")
  assert.deepEqual(own.viaRegistry, {}, "the unit's own test imports it directly")
})

test("1. the unit's own test is selected by its normal edge", () => {
  assert.match(pick([M(U1)]).files.find((f) => f.file === own.file).why, /^imports frontend\/src\/nodes\/u1\/exec\.ts$/)
})

test("2. a test reaching only a lookup module is NOT selected by a unit edit", () => {
  assert.ok(!files(pick([M(U1)])).includes("lookup.test.ts"))
})

test("3. a test reaching an enumerator IS selected (rule a)", () => {
  const why = pick([M(U1)]).files.find((f) => f.file === enumerating.file)?.why
  assert.match(why, /reaches frontend\/src\/lib\/enumerator\.ts, which enumerates the executors registry; frontend\/src\/nodes\/u1\/exec\.ts changed/)
})

test("4. a test naming the unit's type is selected (rule b); naming another unit is not", () => {
  const sel = files(pick([M(U1)]))
  assert.ok(sel.includes("names-u1.test.ts"))
  assert.ok(!sel.includes("names-u2.test.ts"))
})

test("5. an undeclared test naming a registry export (the G4 burn-down) needs every unit (rule c)", () => {
  const sel = pick([M(U1)])
  assert.match(sel.files.find((f) => f.file === burnDown.file)?.why, /names ALL_EXECUTORS \(the executors registry\) and declares no @test-units-by-name/)
  assert.ok(!files(sel).includes("by-name.test.ts"), "@test-units-by-name narrows it to the units it names")
  assert.ok(files(pick([M(U2)])).includes("by-name.test.ts"), "…and selects it for the unit it names")
})

test("6. a @test-watches frontend/src/nodes/** test is selected", () => {
  assert.match(pick([M(U1)]).files.find((f) => f.file === watcher.file)?.why, /^watches frontend\/src\/nodes\/u1\/exec\.ts$/)
})

test("7. a module that may have top-level side effects falls back to every reacher (rule d)", () => {
  const sel = files(pick([M(U1, { sideEffects: true })]))
  assert.ok(sel.includes("lookup.test.ts"))
  assert.ok(files(pick([{ status: "M", path: U1 }])).includes("lookup.test.ts"), "unmarked = unknown = side effects")
})

test("8. a helper OUTSIDE the unit folders is never narrowed, even when only u1 reaches it", () => {
  const sel = files(pick([M(H)]))
  assert.ok(sel.includes("lookup.test.ts") && sel.includes("names-u2.test.ts"), "the plain dependency rule: G7 does not hold it to declarations only")
  assert.match(pick([M(H)]).files.find((f) => f.file === lookup.file).why, /^imports frontend\/src\/lib\/h\.ts$/)
})

test("8b. a watch of unrelated files is no registry declaration (rule c still selects); a watch of the units is", () => {
  const migrations = make("frontend/src/lib/__tests__/migrations.test.ts", '// @test-watches supabase/migrations/*.sql\nimport { ALL_EXECUTORS } from "../composer"\nexpect(ALL_EXECUTORS)\n', [C])
  assert.match(pick([M(U1)], "enforce", [migrations]).files[0]?.why ?? "", /names ALL_EXECUTORS .* counted as needing every unit/)
  // A watch waives (c) only when it covers the changed file.
  const backendOnly = make("frontend/src/lib/__tests__/backend-watch.test.ts", '// @test-watches backend/src/nodes/**\nimport { ALL_EXECUTORS } from "../composer"\nexpect(ALL_EXECUTORS)\n', [C])
  assert.match(pick([M(U1)], "enforce", [backendOnly]).files[0]?.why ?? "", /counted as needing every unit/, "a backend-only watch does not cover a frontend unit change")
  const priceOnly = make("frontend/src/lib/__tests__/price-watch.test.ts", '// @test-watches frontend/src/nodes/*/price.ee.ts\nimport { ALL_EXECUTORS } from "../composer"\nexpect(ALL_EXECUTORS)\n', [C])
  assert.match(pick([M(U1)], "enforce", [priceOnly]).files[0]?.why ?? "", /counted as needing every unit/, "a watch of other unit files does not cover exec.ts")
  const covering = make("frontend/src/lib/__tests__/covering-watch.test.ts", '// @test-watches frontend/src/nodes/**\nimport { ALL_EXECUTORS } from "../composer"\nexpect(ALL_EXECUTORS)\n', [C])
  assert.match(pick([M(U1)], "enforce", [covering]).files[0]?.why ?? "", /^watches frontend\/src\/nodes\/u1\/exec\.ts$/)
  assert.ok(watchesUnits(["frontend/src/nodes/**"]) && watchesUnits(["backend/src/**/*.ts"]) && watchesUnits(["frontend/src/**"]))
  assert.ok(!watchesUnits(["supabase/migrations/*.sql"]) && !watchesUnits(["docs/**"]) && !watchesUnits([]))
})

test("9. a member-line-only aggregate diff is narrowed; a template diff is not", () => {
  const added = pick([M(R, { registryUnits: ["u2"], registry: "executors" })])
  assert.ok(files(added).includes("enumerator.test.ts"), "a node-add changes what enumerators enumerate")
  assert.ok(files(added).includes("names-u2.test.ts"))
  assert.ok(!files(added).includes("lookup.test.ts") && !files(added).includes("names-u1.test.ts"))
  const template = pick([M(R)])
  assert.ok(files(template).includes("lookup.test.ts"), "the plain dependency rule")
})

test("10. a deleted unit file is a full run", () => {
  assert.equal(pick([{ status: "D", path: U2 }]).mode, "full")
})

test("11. TEST_SELECT_REGISTRY_RULE unset: today's selection, and the narrowed list is recorded", () => {
  assert.equal(registryRuleMode(undefined), "shadow")
  assert.equal(registryRuleMode("true"), "shadow")
  assert.equal(registryRuleMode("enforce"), "enforce")
  const shadow = pick([M(U1)], "shadow")
  const legacy = pick([M(U1)], "enforce", TESTS.map((t) => ({ ...t, viaRegistry: {} })))
  assert.deepEqual(files(shadow), files(legacy), "the selection is exactly the plain rule's")
  assert.ok(files(shadow).includes("lookup.test.ts"))
  assert.equal(shadow.registryRule.mode, "shadow")
  assert.deepEqual(shadow.registryRule.selection.files.map((f) => f.file), pick([M(U1)]).files.map((f) => f.file))
  assert.ok(!shadow.registryRule.selection.files.some((f) => f.file === lookup.file))
})

test("12. the pass-cache key of a test reaching u1 only through R changes when u1 changes", () => {
  const opts = (h) => ({ hash: (p) => h[p] ?? "x", trackedFiles: [], environment: "e", sharedWorker: new Set() })
  const before = testKey(lookup, opts({ [U1]: "a" }))
  const after = testKey(lookup, opts({ [U1]: "b" }))
  assert.ok(before && after && before !== after)
})

test("13. the walker unavailable: no cut, today's rule even when enforcing", () => {
  const plain = make("frontend/src/lib/__tests__/lookup.test.ts", 'import { run } from "../lookup"\n', [L], { walker: false })
  assert.deepEqual(plain.viaRegistry, {})
  assert.ok(files(pick([M(U1)], "enforce", [plain])).includes("lookup.test.ts"))
})

test("no units, no registry info: the summary is today's (empty registry fields)", () => {
  const t = summarizeTest({ file: "frontend/src/a.test.ts", source: "", deps: [{ path: "frontend/src/a.ts", source: "" }] })
  assert.deepEqual([t.viaRegistry, t.registryNames, t.unitsByName, t.typeLiterals, t.enumerates], [{}, {}, null, [], {}])
})

test("annotations: @registry globs, named @registry-exports, lookup / enumerates / units-by-name reasons; empty ones declare nothing", () => {
  const a = parseRegistryAnnotations("// @registry frontend/src/nodes/*/exec.ts\n// @registry-exports executors: A B\n// @registry-lookup by type\n")
  assert.deepEqual(a.members, ["frontend/src/nodes/*/exec.ts"])
  assert.deepEqual(a.exports, [{ aggregate: "executors", names: ["A", "B"] }])
  assert.equal(a.lookup, "by type")
  assert.equal(parseRegistryAnnotations("// @registry-enumerates lists every node\n").enumerates, "lists every node")
  assert.equal(parseRegistryAnnotations("// @test-units-by-name names u1\r\n").unitsByName, "names u1")
  const empty = parseRegistryAnnotations("/* @registry-lookup */\n// @test-units-by-name \r\n// @registry-exports executors:\n")
  assert.deepEqual([empty.lookup, empty.unitsByName, empty.exports], [null, null, []])
  assert.deepEqual(parseRegistryAnnotations("// @registry-exports definitions: X\n").members, [], "@registry-exports is not @registry")
})

test("namesUsed: an import binding or an UPPER_SNAKE member read — never a local that shares a generic name", () => {
  const names = new Set(["NODE_OPTIONS", "nodeTypes", "getNodeOptions"])
  assert.deepEqual([...namesUsed('import { NODE_OPTIONS as O } from "@/lib/node-options"\n', names)], ["NODE_OPTIONS"])
  assert.deepEqual([...namesUsed('import { nodeTypes } from "@/components/nodes"\n', names)], ["nodeTypes"])
  assert.deepEqual([...namesUsed("const nodeTypes = new Set()\nnodeTypes.add(1)\n", names)], [])
  assert.deepEqual([...namesUsed('import * as o from "@/lib/node-options"\no.NODE_OPTIONS.map(f)\n', names)], ["NODE_OPTIONS"])
  assert.deepEqual([...namesUsed('import type { NODE_OPTIONS } from "x"\n', names)], [])
  assert.deepEqual([...namesUsed('import { type NODE_OPTIONS, getNodeOptions } from "x"\n', names)], ["getNodeOptions"])
  assert.deepEqual([...namesUsed('export { NODE_OPTIONS } from "./node-options"\n', names)], ["NODE_OPTIONS"])
  assert.deepEqual([...namesUsed('const { getNodeOptions } = await import("@/lib/node-options")\n', names)], ["getNodeOptions"])
  assert.deepEqual([...namesUsed('import * as m from "@/components/nodes"\nObject.keys(m.nodeTypes)\n', names)], ["nodeTypes"], "a namespace read of a lowercase export")
  assert.deepEqual([...namesUsed('const actual = await vi.importActual("@/lib/node-options")\nactual.getNodeOptions()\n', names)], ["getNodeOptions"])
  assert.deepEqual([...namesUsed('const other = makeThing()\nother.nodeTypes\n', names)], [], "not a module object")
  assert.deepEqual([...namesUsed('const t = (await vi.importActual<typeof import("@/components/nodes")>("@/components/nodes")).nodeTypes\n', names)], ["nodeTypes"], "a typed vi.importActual() result read directly")
  assert.deepEqual([...namesUsed('const t = (await importOriginal<typeof import("@/components/nodes")>()).nodeTypes\n', names)], ["nodeTypes"], "a typed importOriginal() result read directly")
  assert.deepEqual([...namesUsed('const t = (await import("@/components/nodes")).nodeTypes\n', names)], ["nodeTypes"])
  assert.deepEqual([...namesUsed('const t = (await vi.importMock<typeof import("@/components/nodes")>("@/components/nodes")).nodeTypes\n', names)], ["nodeTypes"])
  assert.deepEqual([...namesUsed('vi.mock("@/components/nodes", async (importOriginal) => {\n  const orig = await importOriginal<typeof import("@/components/nodes")>()\n  return { ...orig, x: orig.nodeTypes }\n})\n', names)], ["nodeTypes"], "an importOriginal() result")
  assert.deepEqual([...namesUsed('const t = (await import("@/components/nodes")).nodeTypes\n', names)], ["nodeTypes"])
  assert.deepEqual([...namesUsed('const t = (await importOriginal()).nodeTypes\n', names)], ["nodeTypes"])
  assert.deepEqual([...namesUsed('import("@/lib/node-options").then((m) => m.getNodeOptions())\n', names)], ["getNodeOptions"])
  assert.deepEqual([...namesUsed('import("@/lib/node-options").then(({ getNodeOptions }) => getNodeOptions())\n', names)], ["getNodeOptions"])
})

test("enumeratorsIn skips aggregates, units, pass-through composers and lookups", () => {
  const files = [R, U1, C, E, L].map((path) => ({ path, source: SRC[path] }))
  assert.deepEqual(enumeratorsIn(files, info), { executors: E })
})

test("typeLiteralsIn: quoted ids only", () => {
  assert.deepEqual([...typeLiteralsIn(['run("u1")', "u2 in prose", "`u2`"], UNIT_TYPES)].sort(), ["u1", "u2"])
  assert.deepEqual([...typeLiteralsIn(["u1-extra"], UNIT_TYPES)], [])
})

test("unitOf: the unit folder a path belongs to", () => {
  assert.equal(unitOf("frontend/src/nodes/remove-audio/exec.ts"), "remove-audio")
  assert.equal(unitOf("backend/src/nodes/remove-audio/__tests__/route.test.ts"), "remove-audio")
  assert.equal(unitOf("frontend/src/nodes/_generated/executors.ts"), null)
  assert.equal(unitOf("frontend/src/nodes/kit.ts"), null)
  assert.equal(unitOf("frontend/src/lib/x.ts"), null)
})

test("memberLineTypes: only `// unit:` lines changed → those types; anything else → null", () => {
  const base = "// header\nexport const X = {\n} as const\n"
  const one = "// header\nimport { a as unit_a } from \"../a/exec\" // unit:a\nexport const X = {\n  \"a\": unit_a, // unit:a\n} as const\n"
  assert.deepEqual(memberLineTypes(base, one), ["a"])
  assert.deepEqual(memberLineTypes(one, base), ["a"], "a removal too")
  assert.equal(memberLineTypes(base, base.replace("header", "header 2")), null)
  assert.equal(memberLineTypes(base, base), null)
  assert.equal(memberLineTypes(null, base), null)
})

test("compareRegistry: a miss is covered by the main selection and not by the rule's; equal selections differ in nothing", async () => {
  const { compareRegistry } = await import("../test-select/shadow-check.mjs")
  const sel = (mode, files = []) => ({ mode, files })
  assert.deepEqual(compareRegistry({ failed: ["a", "b"], main: sel("affected", ["a"]), registry: sel("none") }), { misses: ["a"], differs: true })
  assert.deepEqual(compareRegistry({ failed: ["a"], main: sel("affected", ["a"]), registry: sel("affected", ["a"]) }), { misses: [], differs: false })
  assert.deepEqual(compareRegistry({ failed: ["a"], main: sel("none"), registry: sel("none") }), { misses: [], differs: false })
  assert.deepEqual(compareRegistry({ failed: ["a"], main: sel("full"), registry: sel("affected", ["b"]) }), { misses: ["a"], differs: true })
})

// Rule (d) uses G7's AST predicate. The tools self-test job has no npm install,
// so this runs where TypeScript is present (locally, and wherever it resolves).
let typescript = null
try { typescript = (await import("node:module")).createRequire(new URL("../../package.json", import.meta.url))("typescript") } catch { /* no TS */ }
test("sideEffectsOf: G7's AST check, for unit files only", { skip: typescript ? false : "needs typescript" }, () => {
  const u = "frontend/src/nodes/u1/exec.ts"
  assert.equal(sideEffectsOf(typescript, u, "export const executor = { run: () => 1 }\n"), false)
  for (const bad of ["export const x = register()\n", "  register()\n", "export const a = 1 // (\nregister()\n"]) assert.equal(sideEffectsOf(typescript, u, bad), true, bad)
  assert.equal(sideEffectsOf(typescript, "frontend/src/lib/h.ts", "export const h = 1\n"), undefined, "never for a file outside a unit")
  assert.equal(sideEffectsOf(null, u, "export const a = 1\n"), undefined, "unknown without TypeScript")
  assert.equal(sideEffectsOf(typescript, u, null), undefined)
})
