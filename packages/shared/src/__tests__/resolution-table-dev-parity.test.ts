// @test-watches packages/shared/src/__tests__/fixtures/resolution-table-dev.json
/**
 * Adding 8K (Kling Image 4.0) to the size vocabulary moves no size and no
 * price that was valid before: for every model in the recorded dev table and
 * every size value dev took, the size sent and the price id are unchanged.
 * Only 8K, a value dev did not take, is new.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MODEL_CATALOG, normalizeModelInput } from "../model-catalog.js"
import { resolveNormalizedImageGen } from "../credit-identifiers.js"

const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "resolution-table-dev.json"), "utf8")) as {
  values: string[]
  table: Record<string, string>
}

/**
 * Sizes that move on purpose since the table was recorded, each with its
 * decision: Kling 4.0 (both ids) renders and bills 4K for `4k` (decided
 * 2026-11-22; it used to collapse to 720p).
 */
const DECIDED_SINCE: Readonly<Record<string, string>> = {
  "kling-4|4k": "4k",
  "kling-4|4K": "4k",
  "kling-4-keyframes|4k": "4k",
  "kling-4-keyframes|4K": "4k",
}

function lineFor(id: string, v: string): string {
  const res = normalizeModelInput(id, { resolution: v }).resolution ?? "-"
  if (MODEL_CATALOG[id]!.kind !== "image") return res
  const a = resolveNormalizedImageGen({ provider: id, resolution: v, refCount: 0, swapToI2i: true }).identifier
  const b = resolveNormalizedImageGen({ provider: id, resolution: v, refCount: 1, swapToI2i: true }).identifier
  return `${res} ${a} ${b}`
}

describe("every size valid before 8K resolves and prices as it did", () => {
  it("has zero differences from the recorded dev table", () => {
    const differ: string[] = []
    let compared = 0
    for (const [key, dev] of Object.entries(fixture.table)) {
      const [id, v] = key.split("|") as [string, string]
      // A model added on dev after this table was taken from it is not here locally.
      if (!MODEL_CATALOG[id]) continue
      compared++
      const now = lineFor(id, v)
      const want = DECIDED_SINCE[key] ?? dev
      if (now !== want) differ.push(`${key}: ${want} -> ${now}`)
    }
    expect(compared).toBeGreaterThan(1500)
    expect(differ).toEqual([])
  })

  it("8K was not a value dev took", () => {
    expect(fixture.values).not.toContain("8K")
  })
})
