import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * sync-lipsync-v3 (fal.ai) is billed per output second at $8/min = $0.13333/s.
 * Credits are stored AT-COST (0% markup; runtime applies the markup):
 *   credits = ceil(0.13333 × bucketSec / $0.02)
 * → 15s=100, 30s=200, 60s=300→400, 120s=800, 300s=2000; bare = 300s ceiling.
 */

const RATE_PER_SEC = 0.13333
const CREDIT_BASE_USD = 0.02
const atCost = (bucketSec: number): number =>
  Math.ceil((RATE_PER_SEC * bucketSec) / CREDIT_BASE_USD)

describe("sync-lipsync-v3 STATIC_CREDIT_COSTS (at-cost, no ×1.25)", () => {
  const cases: Array<[string, number, number | undefined]> = [
    ["sync-lipsync-v3", 2000, 300], // bare = 300s ceiling
    ["sync-lipsync-v3:15s", 100, 15],
    ["sync-lipsync-v3:30s", 200, 30],
    ["sync-lipsync-v3:60s", 400, 60],
    ["sync-lipsync-v3:120s", 800, 120],
    ["sync-lipsync-v3:300s", 2000, 300],
  ]

  it.each(cases)("%s resolves to %i credits", (id, expected) => {
    expect(STATIC_CREDIT_COSTS[id]).toBe(expected)
  })

  it.each(cases.filter(([, , b]) => b !== undefined))(
    "%s (= %i) matches the at-cost formula ceil(0.13333 × bucket / 0.02)",
    (id, expected, bucket) => {
      expect(atCost(bucket as number)).toBe(expected)
      expect(STATIC_CREDIT_COSTS[id]).toBe(atCost(bucket as number))
    },
  )
})
