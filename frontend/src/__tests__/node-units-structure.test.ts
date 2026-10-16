// @vitest-environment node
// @test-watches frontend/src/**/*.{ts,tsx} backend/src/**/*.ts tools/units/** frontend/src/lib/i18n/*.ts
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { loadUnits } from "../../../tools/units/manifest.mjs"
import { centralMentions, composerExportProblems, sideEffectProblems, unitStringProblems } from "../../../tools/units/structure.mjs"
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
const tracked = execFileSync("git", ["ls-files", "frontend/src", "backend/src"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
const products = tracked.filter((p) => /\.(?:ts|tsx|mts|cts|js|jsx|mjs)$/.test(p) && isProductFile(p))
const units = loadUnits(ROOT)
const unitTypes = units.map((u) => u.type)
const DICTS = ["en", "he", "ja", "ko", "pt-br"].map((l) => `frontend/src/lib/i18n/${l}.ts`)
const centralList = JSON.parse(read("tools/units/central-mentions.json")).mentions as Record<string, Record<string, string>>

const inUnit = (p: string, type: string) => p.startsWith(`frontend/src/nodes/${type}/`) || p.startsWith(`backend/src/nodes/${type}/`)
// The places that may name a unit's type id: its own folders, the generated
// outputs (gen:units, and the gen:skills outputs under backend/src), and a
// reasoned central-mentions.json entry.
const GEN_SKILLS_IN_SRC = ["backend/src/lib/mcp/generated/**"]
const allowed = (p: string, type: string) => inUnit(p, type) || matchesAny(p, GEN_UNITS_OUTPUTS) || matchesAny(p, GEN_SKILLS_IN_SRC) || Boolean(centralList[p]?.[type])

describe("composers declare every export that reads their composed collection", () => {
  type Entry = { exports?: Record<string, string[]>; lookups?: string[] }
  const composers = JSON.parse(read("tools/units/registry-composers.json")).composers as Record<string, Entry>

  it("the real composers (tools/units/registry-composers.json exports / lookups)", () => {
    const problems = Object.entries(composers).flatMap(([p, e]) => {
      const collection = new Set(Object.values(e.exports ?? {}).flat())
      if (!collection.size) return []
      return composerExportProblems(ts, p, read(p), collection, new Set([...collection, ...(e.lookups ?? [])])).map((n) => `${p}: ${n}`)
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
  it("the real tree", () => {
    const owned = units.map((u) => ({ type: u.type, keys: Object.keys(u.strings?.keys ?? {}) })).filter((u) => u.keys.length)
    const files = owned.length ? products.map((p) => ({ path: p, source: read(p) })) : []
    expect(unitStringProblems(ts, owned, owned.length ? DICTS.map((p) => ({ path: p, source: read(p) })) : [], files, inUnit)).toEqual([])
  })

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
    ]
    for (const src of ok) expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", src)).toEqual([])
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", 'registerNode("x")')[0]).toMatch(/:1 a top-level ExpressionStatement/)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export const a = load()")[0]).toMatch(/initializer of a may have a side effect/)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "if (x) {}\n")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export default setup()")[0]).toMatch(/export default/)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export let n = 0\nn = 1\n")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export class X { static y = register() }")[0]).toMatch(/class X runs a static initializer/)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "class X { static { register() } }")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export const C = class { static y = register() }")).toHaveLength(1)
    expect(sideEffectProblems(ts, "frontend/src/nodes/x/exec.ts", "export class X { static y = 1; z = register(); run() { go() } }")).toEqual([])
  })
})
