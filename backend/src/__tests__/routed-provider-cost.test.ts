// @test-watches backend/src/workers/handlers/video-ai.ts backend/src/workers/handlers/entity.ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A routed run's provider cost is the ROUTE's billed figure: settlement
 * charges from it and the price factors rise from it. A lane that recomputes a
 * result's cost from the default supplier's rates must do it through
 * `laneProviderCost` (or `withMeasuredRenderCost`), which keep a routed
 * result's figure untouched. This fails a new rate call outside them.
 */
const RATE_CALLS = /\b(seedance25CostUsd|seedance25FlashCostUsd|kling4CostUsd|seedanceLipSyncProviderCost|falGeminiOmniExtendCostUsd)\(/g
const SAFE_SCOPES = ["function withMeasuredRenderCost", "function seedanceLipSyncProviderCost"]

function bodyRanges(src: string): Array<[number, number]> {
  return SAFE_SCOPES.flatMap((head) => {
    const start = src.indexOf(head)
    if (start < 0) return []
    let depth = 0
    let opened = false
    for (let i = src.indexOf("{", src.indexOf(")", start)); i < src.length; i++) {
      if (src[i] === "{") (depth++, (opened = true))
      else if (src[i] === "}" && --depth === 0 && opened) return [[start, i] as [number, number]]
    }
    return []
  })
}

describe("a routed result's provider cost is never recomputed from default rates", () => {
  for (const file of ["workers/handlers/video-ai.ts", "workers/handlers/entity.ts"]) {
    it(file, () => {
      const src = readFileSync(join(__dirname, "..", file), "utf8")
      const safe = bodyRanges(src)
      const bad: number[] = []
      for (const m of src.matchAll(RATE_CALLS)) {
        const at = m.index!
        if (/function\s+$/.test(src.slice(Math.max(0, at - 10), at))) continue
        if (safe.some(([a, b]) => at > a && at < b)) continue
        // Inside a laneProviderCost(...) call opened within the preceding 300 characters.
        if (/laneProviderCost\([^;]*$/.test(src.slice(Math.max(0, at - 300), at))) continue
        bad.push(src.slice(0, at).split("\n").length)
      }
      expect(bad, `rate calls outside laneProviderCost at lines ${bad.join(", ")}`).toEqual([])
    })
  }
})
