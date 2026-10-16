// @vitest-environment node
// @test-watches tools/units/**
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { generate, staleFiles, writeOutputs } from "../../../tools/units/gen.mjs"
import { ALL_SEAM_IDS, liveSeams } from "../../../tools/units/seams.mjs"
import { staticCostsOf, loadTypeScript } from "../../../tools/units/price-reader.mjs"

/**
 * gen:units on the fixture unit `fixture-echo` (tools/units/__fixtures__/tree:
 * every optional file, every seam live), byte-compared with the goldens in
 * tools/units/__fixtures__/expected/. Here, not in the tools self-test job,
 * because the price projection reads price.ee.ts with the TypeScript parser.
 * Update the goldens after a deliberate template change: npx vitest run -u <this file>.
 */

const ROOT = path.resolve(__dirname, "../../..")
const FIXTURE = path.join(ROOT, "tools/units/__fixtures__/tree")
const EXPECTED = path.join(ROOT, "tools/units/__fixtures__/expected")
let tree = ""
let result: Awaited<ReturnType<typeof generate>>

beforeAll(async () => {
  tree = mkdtempSync(path.join(tmpdir(), "units-generator-"))
  cpSync(FIXTURE, tree, { recursive: true })
  const ctx = {
    legacyTypes: new Set(["text-prompt", "upload-video"]),
    families: new Set(["fixture-family"]),
    live: liveSeams(Object.fromEntries(ALL_SEAM_IDS.map((id: string) => [id, true]))),
    capabilities: {},
    exists: (p: string) => existsSync(path.join(tree, p)),
  }
  // The real (lazy, TypeScript) price reader, rooted at the repo so it finds `typescript`.
  const ts = loadTypeScript(ROOT)
  const { readFileSync } = await import("node:fs")
  result = await generate({ root: tree, ctx, readPrice: (rel: string) => staticCostsOf(ts, rel, readFileSync(path.join(tree, rel), "utf8")) })
})
afterAll(() => { if (tree) rmSync(tree, { recursive: true, force: true }) })

describe("gen:units on the fixture unit", () => {
  it("validates and emits", () => {
    expect(result.errors).toEqual([])
    expect(result.outputs.size).toBe(22) // 12 aggregates, 3 projections, 5 dicts, the docs index, the contracts
  })

  it("every output matches its golden", async () => {
    for (const [p, content] of [...result.outputs].sort(([a], [b]) => (a < b ? -1 : 1))) {
      await expect(content).toMatchFileSnapshot(path.join(EXPECTED, p))
    }
  })

  it("the price fallback comes from price.ee.ts through the TypeScript parser", () => {
    expect(result.outputs.get("frontend/src/nodes/fixture-echo/definition.generated.ts")).toMatch(/"priceFallback": 3\n/)
  })

  it("written, the tree is clean", async () => {
    writeOutputs(tree, result)
    expect(staleFiles(tree, result)).toEqual([])
  })
})

describe("staticCostsOf", () => {
  const ts = loadTypeScript(ROOT)
  it("reads a literal, with as const / satisfies", () => {
    expect(staticCostsOf(ts, "p.ts", 'export const staticCosts = { "a": 20, b: 0, "c:hd": 1.5 } as const')).toEqual({ a: 20, b: 0, "c:hd": 1.5 })
    expect(staticCostsOf(ts, "p.ts", "export const staticCosts = { a: 2 } satisfies Record<string, number>")).toEqual({ a: 2 })
  })
  it("never guesses a price", () => {
    expect(() => staticCostsOf(ts, "p.ts", "export const staticCosts = { a: base * 2 }")).toThrow(/number literal/)
    expect(() => staticCostsOf(ts, "p.ts", "export const staticCosts = makeCosts()")).toThrow(/object literal/)
    expect(() => staticCostsOf(ts, "p.ts", "const staticCosts = { a: 1 }")).toThrow(/no exported staticCosts/)
  })
})
