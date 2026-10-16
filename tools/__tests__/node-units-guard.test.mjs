// tools/__tests__/node-units-guard.test.mjs
// The node-unit guards that need no TypeScript (§5.8 B, decided 2026-10-16;
// tools/units/README.md). The AST-based ones (G2, G2b, G7, the runtime twin of
// G1) are frontend/src/__tests__/node-units-structure.test.ts; G5 is a
// boundary rule in tools/structure/.
//   G1  a node type lives in exactly one place: a unit, or the hand-written
//       NODE_DEFINITIONS literal listed in tools/units/legacy-nodes.json
//       (a burn-down: it only shrinks)
//   G3  every aggregate declares @registry / @registry-exports, and only the
//       reviewed composers (tools/units/registry-composers.json) import one
//   G4  a test or product module that names a registry export says how it
//       uses it; the undeclared ones are the burn-downs
//       tools/test-select/registry-users-{tests,product}.json (only shrink)
//   G6  every unit manifest is valid (the same validator as gen:units)
// @test-always walks every tracked file under frontend/ and backend/
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { parseAnnotations, parseRegistryAnnotations } from "../test-select/annotations.mjs"
import { AGGREGATE_FILE, collectRegistries, namesUsed, unitOf, watchesUnits } from "../test-select/registry.mjs"
import { TEST_FILE, TEST_SIDE_HELPER } from "../test-select/test-node.mjs"
import { loadUnits, repoContext, validateUnits } from "../units/manifest.mjs"

const root = new URL("../../", import.meta.url)
const rootPath = decodeURIComponent(root.pathname)
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
const read = (f) => readFileSync(new URL(f, root), "utf8")
const readJson = (f) => JSON.parse(read(f))
const MODULE = /^(frontend|backend)\/.*\.[cm]?[jt]sx?$/
const SKIP = /(?:^|\/)(?:node_modules|dist)\//
const modules = tracked.filter((f) => MODULE.test(f) && !SKIP.test(f))
const isTestish = (f) => TEST_FILE.test(f) || TEST_SIDE_HELPER.test(f)
const products = modules.filter((f) => !isTestish(f))
const testish = modules.filter((f) => /^(frontend|backend)\/src\//.test(f) && isTestish(f))
const composerMap = readJson("tools/units/registry-composers.json").composers
const composerList = Object.keys(composerMap)
const units = loadUnits(rootPath)

// ---------------------------------------------------------------------------
// G1
// ---------------------------------------------------------------------------

/**
 * The type ids of the hand-written definitions literal (its top-level
 * entries): `const LEGACY_NODE_DEFINITIONS = [` since NODE_DEFINITIONS became
 * `legacy ∪ units`; a source that still writes `export const NODE_DEFINITIONS = [` reads the same.
 */
export function literalTypes(source) {
  const legacy = source.search(/^(?:export )?const LEGACY_NODE_DEFINITIONS\b/m)
  const start = legacy >= 0 ? legacy : source.indexOf("export const NODE_DEFINITIONS")
  if (start < 0) return null
  const end = source.indexOf("\n]\n", start)
  return [...source.slice(start, end < 0 ? undefined : end).matchAll(/^ {4}type: "([^"]+)",$/gm)].map((m) => m[1])
}

// PR3 of the plan flips this: from then on a new node must be a unit, and a
// type that appears in the literal without being listed fails. Until the
// scaffold and the docs exist it is reported only, so no node PR is blocked.
const NEW_LEGACY_TYPES_FAIL = false

test("G1: a node type is a unit or a legacy literal entry — never both; the legacy list only shrinks", () => {
  const literal = literalTypes(read("frontend/src/types/nodes.ts"))
  assert.ok(literal && literal.length > 200, "the LEGACY_NODE_DEFINITIONS literal found in frontend/src/types/nodes.ts")
  const listed = readJson("tools/units/legacy-nodes.json").types
  const unitTypes = units.map((u) => u.type)
  const inLiteral = new Set(literal)
  assert.deepEqual(unitTypes.filter((t) => inLiteral.has(t)), [], "these units are ALSO in the NODE_DEFINITIONS literal — a type lives in exactly one place; delete the literal entry")
  assert.deepEqual(unitTypes.filter((t) => listed.includes(t)), [], "these units are still on tools/units/legacy-nodes.json — remove them")
  assert.deepEqual(listed.filter((t) => !inLiteral.has(t)), [], "these are gone from the literal — remove them from tools/units/legacy-nodes.json (it only shrinks)")
  assert.deepEqual([...listed].sort(), listed, "tools/units/legacy-nodes.json is sorted")
  const fresh = literal.filter((t) => !listed.includes(t))
  if (fresh.length && !NEW_LEGACY_TYPES_FAIL) {
    process.stdout.write(`::warning title=New hand-written node (G1)::${fresh.join(", ")} added to NODE_DEFINITIONS; new nodes become units (tools/units/README.md) — this is reported until the unit scaffold lands, then it fails\n`)
  } else {
    assert.deepEqual(fresh, [], "new nodes are units (frontend/src/nodes/<type>/, npm run gen:units -- --new); do not add them to NODE_DEFINITIONS or tools/units/legacy-nodes.json")
  }
  assert.equal(new Set(literal).size, literal.length, "the literal has no duplicate type")
})

test("G1: literalTypes reads only top-level entries", () => {
  const src = 'export const NODE_DEFINITIONS = [\n  {\n    type: "a",\n    exposableFields: [{ key: "k", type: "slider" }],\n  },\n  {\n    type: "b",\n  },\n]\nexport const X = [\n  {\n    type: "c",\n  },\n]\n'
  assert.deepEqual(literalTypes(src), ["a", "b"])
  const composed = 'const LEGACY_NODE_DEFINITIONS: ReadonlyArray<D> = [\n  {\n    type: "a",\n  },\n]\nexport const NODE_DEFINITIONS = compose(LEGACY_NODE_DEFINITIONS, UNITS)\n'
  assert.deepEqual(literalTypes(composed), ["a"], "the legacy literal of a composed NODE_DEFINITIONS")
})

// ---------------------------------------------------------------------------
// G3
// ---------------------------------------------------------------------------

// An import of a node-unit aggregate: any value or dynamic import whose
// specifier goes through a `_generated/` directory (`@/nodes/_generated/…`,
// `../nodes/_generated/…`, `./_generated/…`).
const AGGREGATE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'`]([^"'`]*(?:^|\/)_generated\/[^"'`]*)["'`]/m
export const importsAggregate = (source) => AGGREGATE_IMPORT.test(source)

test("G3: every aggregate declares @registry and @registry-exports; only reviewed composers import one", () => {
  const aggregates = tracked.filter((f) => AGGREGATE_FILE.test(f))
  for (const f of aggregates) {
    const a = parseRegistryAnnotations(read(f))
    assert.ok(a.members.length > 0 && a.exports.length > 0, `${f} must declare // @registry <member-glob> and // @registry-exports <aggregate>: <Name>… (it is generated: run npm run gen:units)`)
  }
  const listed = new Set(composerList)
  const importers = products.filter((f) => !AGGREGATE_FILE.test(f) && importsAggregate(read(f)))
  assert.deepEqual(importers.filter((f) => !listed.has(f) || unitOf(f)), [],
    "these modules import a node-unit aggregate but are not reviewed composers — read the composed collection from its composer instead (or add the file to tools/units/registry-composers.json in a reviewed change)")
})

// A composer `lookups` entry exempts its callers from counting as
// enumerators, so it is sound only when its argument is literally the node
// type (or the key a node type is looked up by): rule (b) then still selects a
// caller that names the type. Credit-id lookups (ids are not type ids:
// composites like "foo:pro", ids built by helpers) and functions returning a
// collection (familyById → .types) go in `exports`. A new lookup is added here
// with that reason, in a reviewed change.
const LOOKUPS_BY_NODE_TYPE = new Set(["isExecutableNode", "familyLabel", "isLocalizedTableKey", "unitDefinitionOf", "unitDescriptorOf"])

test("G3: composer `lookups` are only one-node-type lookups", () => {
  const bad = Object.entries(composerMap).flatMap(([f, e]) => (e.lookups ?? []).filter((n) => !LOOKUPS_BY_NODE_TYPE.has(n)).map((n) => `${f}: ${n}`))
  assert.deepEqual(bad, [], "these composer `lookups` are not reviewed node-type lookups — move them to `exports` (their callers then count as enumerators)")
})

test("G3: every listed composer exists, and @registry-exports appears only on aggregates and listed composers, naming real exports", () => {
  const set = new Set(tracked)
  assert.deepEqual(composerList.filter((f) => !set.has(f)), [], "tools/units/registry-composers.json lists files that do not exist")
  const listed = new Set(composerList)
  const bad = []
  for (const f of products) {
    const src = read(f)
    if (!src.includes("@registry-exports")) continue
    const a = parseRegistryAnnotations(src)
    if (a.exports.length === 0) continue
    if (!AGGREGATE_FILE.test(f) && !listed.has(f)) bad.push(`${f}: carries @registry-exports but is not on tools/units/registry-composers.json`)
    for (const { names } of a.exports) {
      for (const n of names) {
        const exported = new RegExp(`export\\s+(?:const|let|function|async\\s+function|class)\\s+${n.replace(/\$/g, "\\$")}\\b|export\\s*\\{[^}]*\\b${n.replace(/\$/g, "\\$")}\\b[^}]*\\}|export\\s+type\\s+${n.replace(/\$/g, "\\$")}\\b`).test(src)
        if (!exported) bad.push(`${f}: @registry-exports names ${n}, which the file does not export (nothing else may share that line)`)
      }
    }
  }
  for (const [f, entry] of Object.entries(composerMap)) {
    if (!set.has(f)) continue
    const src = read(f)
    for (const names of Object.values(entry.exports ?? {})) {
      for (const n of names) {
        if (!new RegExp(`export\\s+(?:const|let|function|async\\s+function|class)\\s+${n}\\b`).test(src)) bad.push(`tools/units/registry-composers.json: ${f} does not export ${n}`)
      }
    }
  }
  assert.deepEqual(bad, [])
})

// ---------------------------------------------------------------------------
// G4
// ---------------------------------------------------------------------------

const registries = collectRegistries(products.filter((f) => read(f).includes("@registry-exports")).map((path) => ({ path, source: read(path) })), composerMap)
const allNames = new Set([...registries.exportsById.values()].flatMap((s) => [...s]))

/**
 * Tests and test-side helpers that name a registry export and declare none of
 * @test-units-by-name, @test-always or a @test-watches OF THE UNITS
 * ({frontend,backend}/src/nodes/**): a watch of unrelated files (migrations,
 * docs) says nothing about which units the test needs.
 */
export function undeclaredTestUsers(files, names, readSource) {
  return files.filter((f) => {
    const src = readSource(f)
    if (namesUsed(src, names).size === 0) return false
    const a = parseAnnotations(src)
    return !(watchesUnits(a.watches) || a.always || parseRegistryAnnotations(src).unitsByName)
  })
}

/**
 * Product modules that name a registry export and declare neither
 * @registry-lookup nor @registry-enumerates. A composer is a pass-through only
 * for its own registries: a name of another registry counts.
 */
export function undeclaredProductUsers(files, regs, readSource) {
  return files.filter((f) => {
    if (AGGREGATE_FILE.test(f) || unitOf(f)) return false
    const src = readSource(f)
    const own = regs.composers.get(f) ?? new Set()
    const names = new Set([...regs.exportsById].filter(([id]) => !own.has(id)).flatMap(([, s]) => [...s]))
    if (namesUsed(src, names).size === 0) return false
    const a = parseRegistryAnnotations(src)
    return !(a.lookup || a.enumerates)
  })
}

function burnDown(now, file, what, fix) {
  const baseline = readJson(file)
  const known = new Set(baseline)
  assert.deepEqual(now.filter((f) => !known.has(f)), [], `${what}\n${fix}`)
  const current = new Set(now)
  assert.deepEqual(baseline.filter((f) => !current.has(f)), [], `These now declare (or are gone) — remove them from ${file} (it only shrinks).`)
  assert.deepEqual([...baseline].sort(), baseline, `${file} is sorted`)
}

test("G4: the registry exports are known (an empty set would make the guard vacuous)", () => {
  for (const n of ["NODE_DEFINITIONS", "NODE_OPTIONS", "NODE_REGISTRY", "STATIC_CREDIT_COSTS", "nodeTypes", "LABEL_TABLES"]) assert.ok(allNames.has(n), `${n} is a declared registry export`)
})

test("G4: a NEW test that names a registry export declares @test-units-by-name, @test-watches or @test-always; the list only shrinks", () => {
  burnDown(undeclaredTestUsers(testish, allNames, read), "tools/test-select/registry-users-tests.json",
    "These tests name a registry export (NODE_DEFINITIONS, NODE_OPTIONS, …) but declare nothing, so a change to ANY node unit selects them.",
    "Declare `// @test-units-by-name <reason>` when the test only looks up the node types it names, or add `frontend/src/nodes/** backend/src/nodes/**` to its `// @test-watches` when it checks every node (a watch of other files does not count). See tools/test-select/README.md, \"Registries\".")
})

test("G4: a NEW product module that names a registry export declares @registry-lookup or @registry-enumerates; the list only shrinks", () => {
  burnDown(undeclaredProductUsers(products, registries, read), "tools/test-select/registry-users-product.json",
    "These modules name a registry export but declare neither, so they count as enumerators: every test reaching them runs on any node-unit change.",
    "Declare `// @registry-lookup <reason>` when the module only looks up the entry for a type it is given, or `// @registry-enumerates <reason>` when it iterates the collection.")
})

test("G3: importsAggregate on fixtures", () => {
  assert.ok(importsAggregate('import { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"\n'))
  assert.ok(importsAggregate('const m = await import("../../nodes/_generated/routes.js")\n'))
  assert.ok(importsAggregate('export { UNIT_PRICES } from "./_generated/prices.js"\n'.replace("export {", "import {")))
  assert.ok(!importsAggregate('import { x } from "@/lib/mcp/generated/node-handles"\n'))
  assert.ok(!importsAggregate('// see frontend/src/nodes/_generated/definitions.ts\n'))
})

test("G4: the guard's own rules on fixtures", () => {
  const regs = collectRegistries([{ path: "frontend/src/lib/c.ts", source: "// @registry-exports options: NODE_OPTIONS\nexport const NODE_OPTIONS = []\n" }], ["frontend/src/lib/c.ts"])
  const src = {
    "frontend/src/a.test.ts": 'import { NODE_OPTIONS } from "@/lib/c"\n',
    "frontend/src/b.test.ts": '// @test-units-by-name looks up x\nimport { NODE_OPTIONS } from "@/lib/c"\n',
    "frontend/src/c.test.ts": "const nodeTypes = 1\n",
    "frontend/src/d.test.ts": '// @test-watches supabase/migrations/*.sql\nimport { NODE_OPTIONS } from "@/lib/c"\n',
    "frontend/src/e.test.ts": '// @test-watches frontend/src/nodes/**\nimport { NODE_OPTIONS } from "@/lib/c"\n',
    "frontend/src/f.test.ts": 'import * as nodes from "@/components/nodes"\nObject.keys(nodes.nodeTypes)\n',
    "frontend/src/lib/e.ts": 'import { NODE_OPTIONS } from "./c"\nexport const n = NODE_OPTIONS.length\n',
    "frontend/src/lib/l.ts": '// @registry-lookup one option by type\nimport { NODE_OPTIONS } from "./c"\n',
    "frontend/src/lib/c.ts": "// @registry-exports options: NODE_OPTIONS\nexport const NODE_OPTIONS = []\n",
  }
  const names = new Set(["NODE_OPTIONS", "nodeTypes"])
  assert.deepEqual(undeclaredTestUsers(Object.keys(src).filter((f) => f.endsWith(".test.ts")), names, (f) => src[f]), ["frontend/src/a.test.ts", "frontend/src/d.test.ts", "frontend/src/f.test.ts"])
  assert.deepEqual(undeclaredProductUsers(["frontend/src/lib/e.ts", "frontend/src/lib/l.ts", "frontend/src/lib/c.ts"], regs, (f) => src[f]), ["frontend/src/lib/e.ts"])
})

// ---------------------------------------------------------------------------
// G6
// ---------------------------------------------------------------------------

test("G6: every unit manifest in the tree is valid", () => {
  assert.deepEqual(validateUnits(units, repoContext(rootPath)), [])
})
