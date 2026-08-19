import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * sync-lipsync-v3 (fal.ai) credit prices, bucketed by output duration.
 * Literal pins: these ARE the published prices — a drift here is a real
 * price change and must be deliberate (update the model_pricing migration
 * and the node's doc page in the same PR). The bare id reserves at the
 * 300s ceiling because output duration is unknown at submit time.
 */

describe("sync-lipsync-v3 STATIC_CREDIT_COSTS", () => {
  const cases: Array<[string, number]> = [
    ["sync-lipsync-v3", 20000], // bare = 300s ceiling
    ["sync-lipsync-v3:15s", 1000],
    ["sync-lipsync-v3:30s", 2000],
    ["sync-lipsync-v3:60s", 4000],
    ["sync-lipsync-v3:120s", 8000],
    ["sync-lipsync-v3:300s", 20000],
  ]

  it.each(cases)("%s resolves to %i credits", (id, expected) => {
    expect(STATIC_CREDIT_COSTS[id]).toBe(expected)
  })

  it("the bare id equals the largest bucket (unknown duration reserves the ceiling)", () => {
    expect(STATIC_CREDIT_COSTS["sync-lipsync-v3"]).toBe(STATIC_CREDIT_COSTS["sync-lipsync-v3:300s"])
  })

  it("buckets are strictly increasing with duration", () => {
    const ladder = ["15s", "30s", "60s", "120s", "300s"].map((b) => STATIC_CREDIT_COSTS[`sync-lipsync-v3:${b}`]!)
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]!).toBeGreaterThan(ladder[i - 1]!)
  })
})
