// @vitest-environment node
// @test-watches frontend/src/**/*.{ts,tsx} backend/src/**/*.ts packages/*/src/**/*.ts tools/units/** frontend/src/lib/i18n/*.ts
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { loadUnits } from "../../../tools/units/manifest.mjs"
import { centralMentions, composerExportProblems, loadTimeRegistryReads, sideEffectProblems, unitStringProblems } from "../../../tools/units/structure.mjs"
import { AGGREGATE_FILE, collectRegistries } from "../../../tools/test-select/registry.mjs"
import { parseRegistryAnnotations } from "../../../tools/test-select/annotations.mjs"
import { GEN_UNITS_OUTPUTS } from "../../../tools/units/gen.mjs"
import { matchesAny } from "../../../tools/test-select/glob.mjs"
import { isProductFile } from "../../../tools/structure/scanner.mjs"

/**
 * The node-unit guards that need TypeScript (tools/units/README.md, decided
 * 2026-10-16), on the real tree and on the fixture unit
 * (tools/units/__fixtures__/tree):
 *   G2       no string literal of a unit's type id outside its folders
 *   G2b      a unit's strings.json keys are not also hand-written or used elsewhere
 *   G7       unit modules hold declarations only (no top-level side effects)
 * The textual guards (G1, G3, G4, G6) are tools/__tests__/node-units-guard.test.mjs;
 * the runtime twins (G1 over the composed NODE_DEFINITIONS, the vocabularies)
 * are units-vocabulary.test.ts.
 */

const ROOT = path.resolve(__dirname, "../../..")
const FIXTURE = path.join(ROOT, "tools/units/__fixtures__/tree")
const read = (p: string, root = ROOT) => readFileSync(path.join(root, p), "utf8")
// Both trees and every workspace package's source: a package composes units too
// (producer-types.ts, kept-length.ts), so a type id hand-written there is a central mention.
const tracked = execFileSync("git", ["ls-files", "frontend/src", "backend/src", ":(glob)packages/*/src/**"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
const products = tracked.filter((p) => /\.(?:ts|tsx|mts|cts|js|jsx|mjs)$/.test(p) && isProductFile(p))
const units = loadUnits(ROOT)
const unitTypes = units.map((u) => u.type)
const DICTS = ["en", "he", "ja", "ko", "pt-br"].map((l) => `frontend/src/lib/i18n/${l}.ts`)
const centralList = JSON.parse(read("tools/units/central-mentions.json")).mentions as Record<string, Record<string, string>>

const inUnit = (p: string, type: string) => p.startsWith(`frontend/src/nodes/${type}/`) || p.startsWith(`backend/src/nodes/${type}/`)
// The places that may name a unit's type id: its own folders, the generated
// outputs (gen:units, and the gen:skills outputs under backend/src), and a
// reasoned central-mentions.json entry.
const GEN_SKILLS_IN_SRC = ["backend/src/lib/mcp/generated/**", "packages/render-rules/src/generated/**"]
// The node-docs snapshot (scripts/gen-node-docs.mjs, refreshed from the live
// docs site): keyed by every node type that has a page, unit or not — a
// deliberately central step of every node (tools/units/README.md).
const GEN_NODE_DOCS_IN_SRC = ["frontend/src/lib/node-docs/**/*.generated.ts"]
const allowed = (p: string, type: string) => inUnit(p, type) || matchesAny(p, GEN_UNITS_OUTPUTS) || matchesAny(p, GEN_SKILLS_IN_SRC) || matchesAny(p, GEN_NODE_DOCS_IN_SRC) || Boolean(centralList[p]?.[type])

describe("composers declare every export that reads their composed collection", () => {
  type Entry = { exports?: Record<string, string[]>; lookups?: string[] }
  const composers = JSON.parse(read("tools/units/registry-composers.json")).composers as Record<string, Entry>

  it("the real composers (tools/units/registry-composers.json exports / lookups)", () => {
    // A composer may derive from ANOTHER composer's collection of a registry it
    // passes through (workflow-editor/types.ts: NODE_CREDIT_COSTS from
    // UNIT_NODE_DEFINITIONS, both "definitions"): every name of those registries
    // seeds the walk. (A derivation from a registry it does NOT pass through
    // leaves the module an enumerator of that one — selected, so sound.)
    const namesById = new Map<string, Set<string>>()
    for (const e of Object.values(composers)) for (const [id, names] of Object.entries(e.exports ?? {})) namesById.set(id, new Set([...(namesById.get(id) ?? []), ...names]))
    const problems = Object.entries(composers).flatMap(([p, e]) => {
      const own = new Set(Object.values(e.exports ?? {}).flat())
      if (!own.size) return []
      const seeds = new Set([...own, ...Object.keys(e.exports ?? {}).flatMap((id) => [...(namesById.get(id) ?? [])])])
      return composerExportProblems(ts, p, read(p), seeds, new Set([...own, ...(e.lookups ?? [])])).map((n) => `${p}: ${n}`)
    })
    expect(problems, "these composer exports read the composed collection but are not in its registry-composers.json `exports` (callers enumerate) or `lookups` (answers for one given type only) — undeclared, a caller reaching only the composer would skip every unit change").toEqual([])
  })

  it("fixtures: a derived export is caught, directly and through a local helper", () => {
    const src = [
      "export const NODE_REGISTRY = [1]",
      "const enrich = () => NODE_REGISTRY.map((x) => x)",
      "export function getEnrichedRegistry() { return enrich() }",
      "export const findNode = (t: string) => NODE_REGISTRY.find((x) => String(x) === t)",
      "export const unrelated = () => 1",
      "const local = NODE_REGISTRY.length",
      "export { local as countOfNodes }",
    ].join("\n")
    const col = new Set(["NODE_REGISTRY"])
    expect(composerExportProblems(ts, "backend/src/lib/x.ts", src, col, col)).toEqual(["countOfNodes", "findNode", "getEnrichedRegistry"])
    expect(composerExportProblems(ts, "backend/src/lib/x.ts", src, col, new Set([...col, "findNode", "getEnrichedRegistry", "countOfNodes"]))).toEqual([])
  })

  it("fixtures: a value derived from an aggregate import is caught though no export is declared from it", () => {
    const src = [
      'import { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"',
      'import type { UnitNodeType } from "@/nodes/_generated/definitions"',
      "export const NODE_DEFINITIONS = [...UNIT_DEFINITIONS]",
      "export const UNIT_TYPES = UNIT_DEFINITIONS.map((d) => d.type)",
      "export const other = (t: UnitNodeType) => t",
    ].join("\n")
    const col = new Set(["NODE_DEFINITIONS"])
    expect(composerExportProblems(ts, "frontend/src/types/x.ts", src, col, col)).toEqual(["UNIT_TYPES"])
  })

  it("fixtures: a re-export of an aggregate binding is caught (direct, star, and of the local import)", () => {
    const col = new Set(["NODE_DEFINITIONS"])
    const check = (src: string) => composerExportProblems(ts, "frontend/src/types/x.ts", src, col, col)
    expect(check('export { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"')).toEqual(["UNIT_DEFINITIONS"])
    expect(check('export { UNIT_DEFINITIONS as UNITS } from "../nodes/_generated/definitions"')).toEqual(["UNITS"])
    expect(check('export * from "@/nodes/_generated/definitions"')).toEqual(["*"])
    expect(check('export * as defs from "@/nodes/_generated/definitions"')).toEqual(["defs"])
    expect(check('import { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"\nexport { UNIT_DEFINITIONS }')).toEqual(["UNIT_DEFINITIONS"])
    // Type-only re-exports carry no value; other modules' re-exports are not the collection.
    expect(check('export type { UnitNodeType } from "@/nodes/_generated/definitions"')).toEqual([])
    expect(check('export { type UnitNodeType } from "@/nodes/_generated/definitions"')).toEqual([])
    expect(check('export { other } from "@/lib/other"\nexport * from "@/lib/more"')).toEqual([])
  })
})

describe("composers that read every unit while they load are enumerators (registry-composers.json foldsAtLoad)", () => {
  type Entry = { exports?: Record<string, string[]>; foldsAtLoad?: string[] }
  const composers = JSON.parse(read("tools/units/registry-composers.json")).composers as Record<string, Entry>
  // Every name each registry is consumed through: the aggregates' own
  // @registry-exports and the composers' `exports` — what the engine reads.
  const aggregates = tracked.filter((p) => AGGREGATE_FILE.test(p))
  const registries = collectRegistries([...aggregates, ...Object.keys(composers)].map((p) => ({ path: p, source: read(p) })), composers)
  const namesById = registries.exportsById as Map<string, Set<string>>
  // The modules that hold a registry's values: each aggregate, and each
  // composer for the registries it exports — so a default, namespace or
  // dynamic import of one is known.
  const modules = new Map<string, Set<string>>([
    ...[...registries.aggregates].map(([p, a]: [string, { id: string }]) => [p, new Set([a.id])] as [string, Set<string>]),
    ...Object.entries(composers).filter(([, e]) => e.exports).map(([p, e]) => [p, new Set(Object.keys(e.exports ?? {}))] as [string, Set<string>]),
  ])
  const loadReads = (p: string, src = read(p), strict = false) => loadTimeRegistryReads(ts, p, src, namesById, { modules, strict })

  it("the real composers: `foldsAtLoad` is exactly the registries they read at load (of those they export)", () => {
    const problems = Object.entries(composers).flatMap(([p, e]) => {
      const own = Object.keys(e.exports ?? {})
      const declared = [...(e.foldsAtLoad ?? [])].sort()
      const derived = loadReads(p).filter((id: string) => own.includes(id))
      const out = []
      for (const id of declared) if (!own.includes(id)) out.push(`${p}: foldsAtLoad names "${id}", which is not one of its \`exports\``)
      for (const id of derived) if (!declared.includes(id)) out.push(`${p}: reads every unit of "${id}" while it loads — add it to foldsAtLoad (a test importing it fails when one unit breaks, so it is an enumerator, not a pass-through)`)
      for (const id of declared) if (own.includes(id) && !derived.includes(id)) out.push(`${p}: foldsAtLoad names "${id}" but no longer reads it at load — remove it`)
      return out
    })
    expect(problems).toEqual([])
  })

  it("the evidence cases stay folds (the derivation is not vacuous)", () => {
    const folds = (p: string) => loadReads(p)
    expect(folds("frontend/src/lib/node-options.tsx")).toContain("options")
    expect(folds("frontend/src/types/nodes.ts")).toContain("definitions")
    expect(folds("frontend/src/lib/i18n/labels.ts")).toContain("labels")
    expect(folds("backend/src/lib/node-registry.ts")).toContain("registry")
    expect(folds("frontend/src/components/editor/workflow-editor/execute-node.ts")).toEqual([])
  })

  // A module that folds a registry at load and declares @registry-lookup is
  // forbidden here; the engine would still count it an enumerator (the
  // fold wins — test-select-registry.test.mjs), so the combination fails safe.
  it("a @registry-lookup module reads no registry while it loads (it answers for one given type only)", () => {
    const lookups = products.filter((p) => !AGGREGATE_FILE.test(p)).map((p) => ({ p, src: read(p) })).filter(({ src }) => src.includes("@registry-lookup") && parseRegistryAnnotations(src).lookup)
    expect(lookups.length).toBeGreaterThan(3)
    const problems = lookups.flatMap(({ p, src }) => loadReads(p, src, true).map((id: string) => `${p}: declares @registry-lookup but reads every unit of "${id}" while it loads — declare @registry-enumerates instead`))
    expect(problems).toEqual([])
  })

  describe("fixtures: loadTimeRegistryReads", () => {
    const N = new Map([
      ["options", new Set(["UNIT_OPTIONS", "NODE_OPTIONS", "NODE_FAMILIES"])],
      ["definitions", new Set(["UNIT_DEFINITIONS", "UNIT_NODE_DEFINITIONS"])],
      ["registry", new Set(["UNIT_NODE_DESCRIPTORS"])],
      ["labels", new Set(["UNIT_LABELS"])],
    ])
    const M = new Map([
      ["frontend/src/nodes/_generated/definitions.ts", new Set(["definitions"])],
      ["frontend/src/lib/unit-definitions.ts", new Set(["definitions"])],
      ["backend/src/lib/unit-descriptors.ts", new Set(["registry"])],
    ])
    const reads = (src: string, path = "frontend/src/lib/x.ts", strict = false) => loadTimeRegistryReads(ts, path, src, N, { modules: M, strict })
    const bare = (src: string, path = "frontend/src/lib/x.ts") => loadTimeRegistryReads(ts, path, src, N)
    it("a callback through a local function (node-options.tsx unitOption)", () => {
      expect(reads([
        'import { UNIT_OPTIONS } from "@/nodes/_generated/options"',
        'import { UNIT_NODE_DEFINITIONS } from "@/lib/unit-definitions"',
        "function unitOption(u) { return { icon: UNIT_OPTIONS[u.type].icon } }",
        "export const NODE_OPTIONS = composeNodeOptions(LEGACY, UNIT_NODE_DEFINITIONS, unitOption)",
      ].join("\n"))).toEqual(["definitions", "options"])
    })
    it("a .map lambda calling a local helper (node-registry.ts)", () => {
      expect(reads('import { UNIT_NODE_DESCRIPTORS } from "./unit-descriptors.js"\nconst entry = (u) => ({ c: category(u) })\nexport const NODE_REGISTRY = place(LEGACY, UNIT_NODE_DESCRIPTORS.map((u) => entry(u)))\n')).toEqual(["registry"])
    })
    it("Object.values / new Map over the collection, a destructuring, an IIFE, a statement, a static member", () => {
      expect(reads('import { UNIT_LABELS } from "@/nodes/_generated/labels"\nconst L = unitNodeLabels(Object.values(UNIT_LABELS))\n')).toEqual(["labels"])
      expect(reads('import { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"\nconst BY_TYPE = new Map(UNIT_DEFINITIONS.map((d) => [d.type, d]))\n')).toEqual(["definitions"])
      expect(reads('import { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"\nconst [first] = UNIT_DEFINITIONS\n')).toEqual(["definitions"])
      expect(reads('import { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"\nconst n = (() => UNIT_DEFINITIONS.length)()\n')).toEqual(["definitions"])
      expect(reads('import { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"\nfor (const d of UNIT_DEFINITIONS) check(d)\n')).toEqual(["definitions"])
      expect(reads('import { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"\nexport class A { static all = UNIT_DEFINITIONS.length }\n')).toEqual(["definitions"])
      expect(reads('import { UNIT_DEFINITIONS as U } from "@/nodes/_generated/definitions"\nexport const o = { all: [...U] }\n'), "renamed, inside a value of an object literal").toEqual(["definitions"])
      expect(reads('import * as agg from "@/nodes/_generated/definitions"\nexport const n = agg.UNIT_DEFINITIONS.length\n'), "a namespace import of a known aggregate").toEqual(["definitions"])
      expect(bare('import * as agg from "@/nodes/_generated/definitions"\nexport const n = Object.keys(agg).length\n'), "an aggregate it is not told about counts for every registry").toEqual(["definitions", "labels", "options", "registry"])
    })
    it("lazy reads, a bare alias, types, memo, and the composer's own export names read nothing at load", () => {
      expect(reads('import { UNIT_OPTIONS } from "@/nodes/_generated/options"\nexport function get(t) { return UNIT_OPTIONS[t] }\nexport const run = (t) => UNIT_OPTIONS[t]\nexport const kit = { run(t) { return UNIT_OPTIONS[t] }, all: () => UNIT_OPTIONS }\nexport class K { all = UNIT_OPTIONS; m() { return UNIT_OPTIONS } }\n')).toEqual([])
      expect(reads('import { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"\nexport const UNIT_NODE_DEFINITIONS: ReadonlyArray<D> = UNIT_DEFINITIONS as ReadonlyArray<D>\nexport { UNIT_DEFINITIONS as ALL }\n')).toEqual([])
      expect(reads('import type { UNIT_DEFINITIONS } from "@/nodes/_generated/definitions"\nexport const n: typeof UNIT_DEFINITIONS = []\n')).toEqual([])
      expect(reads('import React, { memo } from "react"\nimport { UNIT_OPTIONS } from "@/nodes/_generated/options"\nfunction C() { return UNIT_OPTIONS.x }\nexport const N = memo(C)\nexport const F = React.forwardRef(() => UNIT_OPTIONS.y)\nexport const L = React.lazy(() => import("./c"))\n', "frontend/src/lib/x.tsx")).toEqual([])
      expect(reads('import { UNIT_OPTIONS } from "@/nodes/_generated/options"\nconst inner = () => UNIT_OPTIONS\nexport function outer() { return inner() }\n'), "a reader reached only from a lazy function").toEqual([])
      expect(reads("export const NODE_FAMILIES = [{ id: 1 }]\nexport const FAMILY_RANK = new Map(NODE_FAMILIES.map((f, i) => [f.id, i]))\n"), "its own names are not the units").toEqual([])
      expect(reads("const x = { NODE_OPTIONS: 1 }\nexport const y = x.NODE_OPTIONS\n")).toEqual([])
    })
    it("memo / forwardRef / lazy: only React's, and only the FUNCTION arguments are stored unrun", () => {
      expect(reads('import React from "react"\nimport { UNIT_OPTIONS } from "@/nodes/_generated/options"\nexport const C = React.memo(build(UNIT_OPTIONS))\n')).toEqual(["options"])
      expect(reads('import { memo } from "react"\nimport { UNIT_OPTIONS } from "@/nodes/_generated/options"\nexport const C = memo(Base, () => UNIT_OPTIONS.x === 1)\nexport const D = memo(UNIT_OPTIONS.Comp)\n')).toEqual(["options"])
      expect(reads('import { UNIT_OPTIONS } from "@/nodes/_generated/options"\nconst lazy = (xs) => xs\nexport const all = lazy(UNIT_OPTIONS.map((o) => o.icon))\n'), "a local `lazy` is any call").toEqual(["options"])
      expect(reads('import { UNIT_OPTIONS } from "@/nodes/_generated/options"\nfunction C() { return UNIT_OPTIONS.x }\nexport const N = memo(C)\n'), "an unimported `memo` is any call: it may run C").toEqual(["options"])
    })
    it("namespace, default and dynamic imports of a module that holds the registry", () => {
      expect(reads('import * as UD from "@/lib/unit-definitions"\nconst BY = new Map(UD.UNIT_NODE_DEFINITIONS.map((d) => [d.type, d]))\n')).toEqual(["definitions"])
      expect(reads('import * as UD from "@/lib/unit-definitions"\nexport const all = Object.values(UD)\n'), "a bare namespace of a composer").toEqual(["definitions"])
      expect(reads('import * as Any from "@/lib/anything"\nexport const n = Any.UNIT_NODE_DEFINITIONS.length\nexport const m = Any.other.length\n'), "any namespace, by name").toEqual(["definitions"])
      expect(reads('import defs from "../nodes/_generated/definitions"\nexport const n = defs.length\n')).toEqual(["definitions"])
      expect(reads('import descriptors from "./unit-descriptors.js"\nexport const n = descriptors.length\n', "backend/src/lib/x.ts")).toEqual(["registry"])
      expect(reads('const { UNIT_NODE_DEFINITIONS: D } = await import("@/lib/unit-definitions")\n')).toEqual(["definitions"])
      expect(reads('const m = await import("@/lib/unit-definitions")\nexport const n = m.UNIT_NODE_DEFINITIONS.length\n')).toEqual(["definitions"])
      expect(reads('export const loaded = import("@/lib/unit-definitions").then((m) => check(m))\n')).toEqual(["definitions"])
      expect(reads('export async function later() { return (await import("@/lib/unit-definitions")).UNIT_NODE_DEFINITIONS }\n'), "a dynamic import in a lazy function").toEqual([])
      expect(reads('import React from "react"\nimport * as UD from "@/lib/unit-definitions"\nexport function f() { return UD.unitDefinitionOf("x") }\nexport const k = UD.unitDefinitionOf\n'), "a namespace's other member, named or read lazily").toEqual([])
    })
    it("a class constructed at load runs its constructor and instance fields", () => {
      expect(reads('import { UNIT_LABELS as A } from "@/nodes/_generated/labels"\nexport const x = new (class { constructor() { fold(A) } })()\n')).toEqual(["labels"])
      expect(reads('import { UNIT_LABELS as A } from "@/nodes/_generated/labels"\nexport const x = new (class { all = Object.keys(A) })()\n')).toEqual(["labels"])
      expect(reads('import { UNIT_LABELS as A } from "@/nodes/_generated/labels"\nclass K { all = Object.keys(A) }\nexport const k = new K()\n')).toEqual(["labels"])
      expect(reads('import { UNIT_LABELS as A } from "@/nodes/_generated/labels"\nexport class K { all = Object.keys(A); constructor() { fold(A) } }\nexport const C = class { m() { return A } }\n'), "defined, never constructed").toEqual([])
    })
    it("naming a function is not reading it; strict (the @registry-lookup guard) counts only a call or a read", () => {
      const get = 'import { UNIT_OPTIONS } from "@/nodes/_generated/options"\nconst get = (t) => UNIT_OPTIONS[t]\n'
      for (const src of ["export const API = { get }\n", "export const list = [get]\n", "export default { get }\n", "[get]\n", "export const t = typeof UNIT_OPTIONS\n", "export const g = get\n"]) {
        expect(reads(get + src), src).toEqual([])
        expect(reads(get + src, undefined, true), src).toEqual([])
      }
      expect(reads(get + 'registerResolver("x", get)\n'), "handed to a call, it may run now").toEqual(["options"])
      expect(reads(get + 'registerResolver("x", get)\n', undefined, true), "strict: a reference handed over is not a read").toEqual([])
      expect(reads(get + 'registerResolver("x", (t) => get(t))\n', undefined, true)).toEqual([])
      expect(reads(get + 'export const all = TYPES.map(get)\n', undefined, true), "strict: an iterating method runs it").toEqual(["options"])
      expect(reads(get + 'export const one = get("x")\n', undefined, true)).toEqual(["options"])
      expect(reads(get + 'export const n = Object.keys(UNIT_OPTIONS).length\n', undefined, true), "strict: a value handed to a call is read").toEqual(["options"])
    })
    it("unparseable source counts as reading what it names", () => {
      expect(reads('import { UNIT_LABELS } from "@/nodes/_generated/labels"\nexport const = (\n')).toEqual(["labels"])
    })
  })
})

describe("G2 — no central mention of a unit's type id", () => {
  it("the real tree", () => {
    const files = unitTypes.length ? products.map((p) => ({ path: p, source: read(p) })) : []
    expect(centralMentions(ts, files, unitTypes, allowed)).toEqual([])
  })

  it("central-mentions.json only names units that exist and files that still name them (it only shrinks)", () => {
    const stale = Object.entries(centralList).flatMap(([p, byType]) => Object.keys(byType)
      .filter((t) => !unitTypes.includes(t) || !tracked.includes(p) || !read(p).includes(t)).map((t) => `${p}: ${t}`))
    expect(stale).toEqual([])
  })

  it("fixtures: a string literal counts; a comment, a longer id and the unit's own folder do not", () => {
    const files = [
      { path: "frontend/src/lib/a.ts", source: 'export const t = "fixture-echo"' },
      { path: "frontend/src/lib/b.ts", source: "// fixture-echo is mentioned in prose only\nexport const t = 1" },
      { path: "frontend/src/lib/c.ts", source: 'export const t = "fixture-echo-pro"' },
      { path: "frontend/src/lib/d.tsx", source: "export const C = () => <div data-type={`fixture-echo`} />" },
      { path: "frontend/src/nodes/fixture-echo/exec.ts", source: 'export const t = "fixture-echo"' },
      { path: "frontend/src/nodes/_generated/definitions.ts", source: 'export const t = "fixture-echo"' },
    ]
    const allow = (p: string, t: string) => inUnit(p, t) || matchesAny(p, GEN_UNITS_OUTPUTS)
    expect(centralMentions(ts, files, ["fixture-echo"], allow)).toEqual(['frontend/src/lib/a.ts: "fixture-echo"', 'frontend/src/lib/d.tsx: "fixture-echo"'])
  })
})

describe("G2b — unit-owned i18n keys", () => {
  // It reads every product file for every unit-owned key (~3 s alone, more under a full suite's load): 20 s, not vitest's 5 s.
  it("the real tree", () => {
    const owned = units.map((u) => ({ type: u.type, keys: Object.keys(u.strings?.keys ?? {}) })).filter((u) => u.keys.length)
    const files = owned.length ? products.map((p) => ({ path: p, source: read(p) })) : []
    expect(unitStringProblems(ts, owned, owned.length ? DICTS.map((p) => ({ path: p, source: read(p) })) : [], files, inUnit)).toEqual([])
  }, 20_000)

  it("fixtures: a key that is also hand-written, or used outside the unit, stays central", () => {
    const dicts = [{ path: "frontend/src/lib/i18n/en.ts", source: 'export const en = {\n  "node.fixtureEcho": "x",\n  // gen:units start\n  "fixtureEcho.help": "y",\n  // gen:units end\n}\n' }]
    const files = [
      { path: "frontend/src/components/upload.tsx", source: 'export const k = t("fixtureEcho.help")' },
      { path: "frontend/src/nodes/fixture-echo/config.tsx", source: 'export const k = t("fixtureEcho.help")' },
    ]
    expect(unitStringProblems(ts, [{ type: "fixture-echo", keys: ["node.fixtureEcho", "fixtureEcho.help"] }], dicts, files, inUnit)).toEqual([
      'fixture-echo: "fixtureEcho.help" is used by frontend/src/components/upload.tsx — keep it hand-written in the dicts, not in strings.json',
      'fixture-echo: "node.fixtureEcho" is also hand-written in frontend/src/lib/i18n/en.ts — a unit owns only keys it alone uses',
    ])
  })
})

describe("G7 — unit modules have no top-level side effects", () => {
  const moduleFiles = (root: string) => loadUnits(root).flatMap((u) => (["frontend", "backend"] as const)
    .flatMap((tree) => u.files[tree].filter((f: string) => /\.(?:ts|tsx)$/.test(f)).map((f: string) => `${u.dirs[tree]}/${f}`)))

  it("the real tree", () => {
    expect(moduleFiles(ROOT).flatMap((p) => sideEffectProblems(ts, p, read(p)))).toEqual([])
  })

  it("the fixture unit: every one of its modules is declarations only", () => {
    const files = moduleFiles(FIXTURE)
    expect(files.length).toBeGreaterThan(8)
    expect(files.flatMap((p) => sideEffectProblems(ts, p, read(p, FIXTURE)))).toEqual([])
  })

  it("fixtures: what counts as a side effect", () => {
    const ok = [
      'import { memo } from "react"\nexport const N = memo(() => null)\nexport function f() { run() }\nexport default async function route() {}',
      'import { z } from "zod"\nexport const Body = z.object({ a: z.string() })\nexport const s = new Set(["a"])\nexport type T = 1\nexport const o = { a: 1, f() {}, ...{ b: 2 } } as const',
      'import { z } from "zod"\nexport const Body = z.object({ id: z.string().uuid().optional(), n: z.number().int().min(1).default(2) })',
    ]
    for (const src of ok) expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", src)).toEqual([])
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", 'registerNode("x")')[0]).toMatch(/:1 a top-level ExpressionStatement/)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export const a = load()")[0]).toMatch(/initializer of a may have a side effect/)
    // A call chain is pure only when it is a zod schema all the way down, with pure arguments.
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export const a = load().optional()")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export const a = z.string().transform(register())")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "if (x) {}\n")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export default setup()")[0]).toMatch(/export default/)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export let n = 0\nn = 1\n")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export class X { static y = register() }")[0]).toMatch(/class X runs code when it is defined/)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "class X { static { register() } }")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export const C = class { static y = register() }")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export class X { static y = 1; z = register(); run() { go() } }")).toEqual([])
    // Decorators and computed member names run when the class is defined.
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "@register() export class X {}")[0]).toMatch(/class X runs code when it is defined/)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export class X { @track() run() {} }")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export class X { constructor(@inject() a: number) {} }")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export class X { [compute()] = 1 }")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export class X { [compute()]() {} }")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export const C = class { [compute()] = 1 }")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export const o = { [k()]() {}, get [g()]() { return 1 } }")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", 'const K = "k"\nexport class X { [K] = 1; ["a"]() {} }\nexport const o = { [K]() {} }')).toEqual([])
  })
})
