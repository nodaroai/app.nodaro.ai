// @test-watches frontend/src/nodes/** backend/src/nodes/** tools/units/__fixtures__/tree/**
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { dataInterfaceName } from "../../../tools/units/manifest.mjs"

/**
 * A unit priced by its settings states the id a run reserves twice: the
 * server's `price.ee.ts` `creditId` (what the route reserves) and the editor's
 * `price-id.ts` `creditId` (what the Run button and the estimate quote). The
 * unit validator only checks both files exist; this holds them to the SAME id,
 * evaluated over the unit's default data, empty data, each default setting
 * varied on its own (a number to its edges and steps, a string emptied or
 * unknown, a boolean flipped), and every value of every enum-like setting its
 * data type declares (types.ts: a property typed as a union of literals) —
 * so a price that branches on a boolean or a non-default enum value cannot
 * drift, and a quote can never name a row the run does not reserve. The fixture unit (tools/units/__fixtures__/tree) is
 * walked too, so the guard never passes on an empty set.
 */

const ROOT = path.resolve(__dirname, "../../..")
const TREES = [ROOT, path.join(ROOT, "tools/units/__fixtures__/tree")]

type CreditIdFn = (data: Readonly<Record<string, unknown>>) => string

interface PricedUnit {
  readonly type: string
  readonly defaultData: Readonly<Record<string, unknown>>
  /** Each enum-like setting its data type declares, with every value. */
  readonly enums: Readonly<Record<string, ReadonlyArray<string | number | boolean>>>
  readonly editor: string
  readonly server: string
}

/**
 * The enum-like settings a unit's data type declares: each property of the
 * exported `<Type>Data` (interface or type literal) typed as a union of
 * literals (strings, numbers, true/false; null and undefined skipped), with
 * every literal. Read from the source, so a new enum value is sampled the
 * day it is declared.
 */
export function declaredEnums(typesSource: string, dataName: string): Record<string, ReadonlyArray<string | number | boolean>> {
  const sf = ts.createSourceFile("types.ts", typesSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const members: ts.TypeElement[] = []
  const collect = (t: ts.TypeNode | undefined): void => {
    if (!t) return
    if (ts.isTypeLiteralNode(t)) members.push(...t.members)
    else if (ts.isIntersectionTypeNode(t)) t.types.forEach(collect)
  }
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st) && st.name.text === dataName) members.push(...st.members)
    if (ts.isTypeAliasDeclaration(st) && st.name.text === dataName) collect(st.type)
  }
  const out: Record<string, ReadonlyArray<string | number | boolean>> = {}
  for (const m of members) {
    if (!ts.isPropertySignature(m) || !m.type || !m.name || !(ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) continue
    const arms = ts.isUnionTypeNode(m.type) ? m.type.types : [m.type]
    const values: Array<string | number | boolean> = []
    let allLiteral = true
    for (const a of arms) {
      if (a.kind === ts.SyntaxKind.UndefinedKeyword) continue
      if (ts.isLiteralTypeNode(a)) {
        const l = a.literal
        if (l.kind === ts.SyntaxKind.NullKeyword) continue
        if (ts.isStringLiteral(l)) values.push(l.text)
        else if (ts.isNumericLiteral(l)) values.push(Number(l.text))
        else if (l.kind === ts.SyntaxKind.TrueKeyword) values.push(true)
        else if (l.kind === ts.SyntaxKind.FalseKeyword) values.push(false)
        else allLiteral = false
      } else if (a.kind === ts.SyntaxKind.BooleanKeyword) values.push(true, false)
      else allLiteral = false
    }
    if (allLiteral && values.length > 0) out[m.name.text] = values
  }
  return out
}

function pricedUnits(): PricedUnit[] {
  return TREES.flatMap((root) => {
    const dir = path.join(root, "frontend/src/nodes")
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((type) => existsSync(path.join(dir, type, "price-id.ts")))
      .map((type) => {
        const manifest = JSON.parse(readFileSync(path.join(dir, type, "unit.json"), "utf8")) as { defaultData?: Record<string, unknown> }
        const typesFile = path.join(dir, type, "types.ts")
        return {
          type,
          defaultData: manifest.defaultData ?? {},
          enums: existsSync(typesFile) ? declaredEnums(readFileSync(typesFile, "utf8"), dataInterfaceName(type)) : {},
          editor: path.join(dir, type, "price-id.ts"),
          server: path.join(root, "backend/src/nodes", type, "price.ee.ts"),
        }
      })
  })
}

/**
 * Each default setting varied on its own (numbers to edges and steps, strings
 * emptied or unknown, booleans flipped), and every declared value of every
 * enum-like setting, alone and with each other default.
 */
export function samplesOf(unit: Pick<PricedUnit, "defaultData" | "enums">): Array<Readonly<Record<string, unknown>>> {
  const d = unit.defaultData
  const varied = Object.entries(d).flatMap(([k, v]) => {
    if (typeof v === "number") return [0, 1, -1, 2.5, v + 1, v * 2, 1000].map((n) => ({ ...d, [k]: n }))
    if (typeof v === "string") return [{ ...d, [k]: "" }, { ...d, [k]: "not-a-setting" }]
    if (typeof v === "boolean") return [{ ...d, [k]: !v }]
    return []
  })
  const enums = Object.entries(unit.enums).flatMap(([k, values]) => values.map((value) => ({ ...d, [k]: value })))
  return [d, {}, ...varied, ...enums]
}

async function creditIdOf(file: string, pick: (mod: Record<string, unknown>) => unknown): Promise<CreditIdFn> {
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>
  const fn = pick(mod)
  if (typeof fn !== "function") throw new Error(`${path.relative(ROOT, file)} exports no creditId`)
  return fn as CreditIdFn
}

describe("the samples reach every boolean and every declared enum value", () => {
  it("flips a boolean default and tries each literal of a declared union", () => {
    const src = `export type ProbeData = {\n  [key: string]: unknown\n  label: string\n  size?: "1K" | "2K" | "auto"\n  draft?: boolean\n  steps?: 1 | 2 | null\n  note?: string\n}\n`
    const enums = declaredEnums(src, "ProbeData")
    expect(enums).toEqual({ size: ["1K", "2K", "auto"], draft: [true, false], steps: [1, 2] })
    const samples = samplesOf({ defaultData: { label: "P", size: "1K", draft: false }, enums })
    expect(samples).toContainEqual({ label: "P", size: "1K", draft: true })
    for (const v of ["1K", "2K", "auto"]) expect(samples).toContainEqual({ label: "P", size: v, draft: false })
    expect(samples).toContainEqual({ label: "P", size: "1K", draft: false, steps: 2 })
    expect(declaredEnums("export interface ProbeData { mode: \"a\" | \"b\"; free: string }", "ProbeData")).toEqual({ mode: ["a", "b"] })
  })
})

describe("a unit priced by its settings names the same credit id in the editor and on the server", () => {
  const units = pricedUnits()

  it("walks at least the fixture unit", () => {
    expect(units.map((u) => u.type)).toContain("fixture-echo")
  })

  it.each(units.map((u) => [u.type, u] as const))("%s: price-id.ts creditId === price.ee.ts creditId", async (_type, unit) => {
    expect(existsSync(unit.server), `${path.relative(ROOT, unit.server)} is missing`).toBe(true)
    const editor = await creditIdOf(unit.editor, (m) => m.creditId)
    const server = await creditIdOf(unit.server, (m) => (m.price as { creditId?: unknown } | undefined)?.creditId)
    for (const data of samplesOf(unit)) {
      expect(editor(data), `${unit.type} over ${JSON.stringify(data)}`).toBe(server(data))
    }
  })
})
