// @vitest-environment node
// @test-watches tools/units/** tools/structure/ratchets.mjs frontend/src/nodes/*.ts backend/src/nodes/*.ts
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import ts from "typescript"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { main } from "../../../tools/units/gen.mjs"
import { loadUnits } from "../../../tools/units/manifest.mjs"
import { ALL_SEAM_IDS, liveSeams } from "../../../tools/units/seams.mjs"
import { CAPABILITIES } from "../../../tools/units/capabilities.mjs"
import { loadTypeScript, staticCostsOf } from "../../../tools/units/price-reader.mjs"
import { centralMentions, sideEffectProblems } from "../../../tools/units/structure.mjs"
import { BOUNDARY_RULES } from "../../../tools/structure/ratchets.mjs"

/**
 * `npm run gen:units -- --new` scaffolds one unit of every execution.kind into
 * a copy of the fixture tree (every seam live), through the real CLI and the
 * real TypeScript price reader, and each scaffold must pass what the unit
 * guards check on a real unit:
 *   gen:units --check   no drift once written
 *   G2                  its type id is named only inside its own folders
 *   G5                  it imports no other unit, aggregate, composer or engine
 *                       module — and every import resolves to a real file
 *   G7                  its modules hold declarations only
 * Flags and refusals: tools/__tests__/units-scaffold.test.mjs. That the
 * templates typecheck against the product: units-scaffold-typecheck.test.ts.
 */

const ROOT = path.resolve(__dirname, "../../..")
const FIXTURE = path.join(ROOT, "tools/units/__fixtures__/tree")
const KINDS = ["worker", "sync", "inline", "source"] as const
const typeOf = (kind: string) => `scaffold-${kind}`
let tree = ""

const sink = () => {
  const lines: string[] = []
  return { lines, write: (s: string) => { lines.push(s) } }
}

beforeAll(async () => {
  tree = mkdtempSync(path.join(tmpdir(), "units-scaffold-"))
  cpSync(FIXTURE, tree, { recursive: true })
  const ctx = {
    legacyTypes: new Set(["text-prompt", "upload-video"]),
    families: new Set(["fixture-family"]),
    live: liveSeams(Object.fromEntries(ALL_SEAM_IDS.map((id: string) => [id, true]))),
    capabilities: CAPABILITIES,
    exists: (p: string) => existsSync(path.join(tree, p)),
  }
  const tsApi = loadTypeScript(ROOT)
  const readPrice = (rel: string) => staticCostsOf(tsApi, rel, readFileSync(path.join(tree, rel), "utf8"))
  for (const kind of KINDS) {
    const argv = [
      "--new", typeOf(kind), "--category", "processing", "--kind", kind, "--after", "upload-video",
      "--family", "fixture-family", "--picker-after", "first", "--description", `A ${kind} scaffold.`,
      ...(kind === "worker" || kind === "sync" ? ["--price", "5"] : []),
      ...(kind === "worker" ? ["--characterize", "first"] : []),
    ]
    const err = sink()
    const rc = await main(argv, tree, sink(), err, { ctx, readPrice })
    if (rc !== 0) throw new Error(`--new --kind ${kind} failed: ${err.lines.join("")}`)
  }
  const check = sink()
  const rc = await main(["--check"], tree, sink(), check, { ctx, readPrice })
  if (rc !== 0) throw new Error(`gen:units --check after the scaffolds: ${check.lines.join("")}`)
})
afterAll(() => { if (tree) rmSync(tree, { recursive: true, force: true }) })

/** Every scaffolded TS module: repo path → source. */
function scaffoldedModules(): Array<{ path: string; source: string }> {
  return loadUnits(tree)
    .filter((u: { type: string }) => u.type.startsWith("scaffold-"))
    .flatMap((u: { dirs: Record<string, string>; files: Record<string, string[]> }) => (["frontend", "backend"] as const)
      .flatMap((t) => u.files[t].filter((f) => /\.tsx?$/.test(f)).map((f) => `${u.dirs[t]}/${f}`)))
    .map((p: string) => ({ path: p, source: readFileSync(path.join(tree, p), "utf8") }))
}

/** The repo path a value import of `spec` in `from` resolves to; null for a package. */
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? `frontend/src/${spec.slice(2)}`
    : spec.startsWith(".") ? path.posix.join(path.posix.dirname(from), spec)
      : null
  if (base === null) return null
  const stem = base.replace(/\.js$/, "")
  const candidates = [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`]
  return candidates.find((c) => existsSync(path.join(tree, c)) || existsSync(path.join(ROOT, c))) ?? `${stem} (unresolved)`
}

/** The value (not type-only) import specifiers of a module. */
function valueImports(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  return sf.statements.flatMap((st) => (ts.isImportDeclaration(st) && !st.importClause?.isTypeOnly && ts.isStringLiteral(st.moduleSpecifier) ? [st.moduleSpecifier.text] : []))
}

describe("gen:units --new, one unit of every execution.kind", () => {
  it("each kind scaffolded and validated, and gen:units --check is clean (beforeAll)", () => {
    expect(loadUnits(tree).map((u: { type: string }) => u.type)).toEqual(["fixture-echo", ...KINDS.map(typeOf)].sort())
  })

  it("the price fallback of a node with a route comes from its price.ee.ts", () => {
    for (const kind of ["worker", "sync"]) {
      expect(readFileSync(path.join(tree, `frontend/src/nodes/${typeOf(kind)}/definition.generated.ts`), "utf8")).toMatch(/"priceFallback": 5\n/)
    }
    expect(readFileSync(path.join(tree, "frontend/src/nodes/scaffold-source/definition.generated.ts"), "utf8")).toMatch(/"priceFallback": null\n/)
  })

  it("G7: every scaffolded module is declarations only", () => {
    const modules = scaffoldedModules()
    // worker 13 (its characterize.char.ts included), sync 10, inline 7, source 6 (.ts/.tsx, the generated projections included)
    expect(modules.length).toBe(36)
    expect(modules.flatMap((m) => sideEffectProblems(ts, m.path, m.source))).toEqual([])
  })

  it("G2: a scaffold names its type id only inside its own folders", () => {
    const types = KINDS.map(typeOf)
    const inOwn = (p: string, type: string) => p.startsWith(`frontend/src/nodes/${type}/`) || p.startsWith(`backend/src/nodes/${type}/`)
    // Every scaffolded module, judged against every scaffolded type: another scaffold's folder is NOT its own.
    expect(centralMentions(ts, scaffoldedModules(), types, inOwn)).toEqual([])
  })

  it("G5: a scaffold imports no other unit, aggregate, composer or engine module, and every import resolves", () => {
    const rule = BOUNDARY_RULES.find((r: { id: string }) => r.id === "node-units") as { violates: (from: string, to: string) => boolean }
    const problems = scaffoldedModules().flatMap((m) => valueImports(m.path, m.source).flatMap((spec) => {
      const to = resolveImport(m.path, spec)
      if (to === null) return []
      if (to.endsWith("(unresolved)")) return [`${m.path}: "${spec}" resolves to no file`]
      return rule.violates(m.path, to) ? [`${m.path} -> ${to}`] : []
    }))
    expect(problems).toEqual([])
  })
})
