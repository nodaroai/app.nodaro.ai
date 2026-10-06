/**
 * The batch price endpoint answers an id it prices nowhere in `missing` (a 200):
 * a speech `<model>:per-100-chars` row on an instance without length pricing,
 * an unseeded admin row. The prefetch remembers those for the session, so an
 * estimate that runs on every graph change does not ask for them again — and a
 * reader that finds no cached price quotes without it (the flat row).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const api = vi.hoisted(() => ({
  calls: [] as string[][],
  answer: { data: {} as Record<string, number>, missing: [] as string[] },
}))
vi.mock("@/lib/api", () => ({
  fetchBatchModelCreditCosts: vi.fn(async (models: string[]) => {
    api.calls.push(models)
    return api.answer
  }),
  getBatchModelCreditCosts: vi.fn(),
  getModelCreditCost: vi.fn(),
}))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))

import { queryClient } from "@/lib/query-client"
import { forgetUnpricedModels, getCachedModelCredits, isModelUnpriced, prefetchModelCreditCosts, rememberUnpricedModels } from "../use-model-credit-cost"

const UNIT = "elevenlabs-v4:per-100-chars"

beforeEach(() => {
  queryClient.clear()
  forgetUnpricedModels()
  api.calls = []
  api.answer = { data: {}, missing: [] }
})

describe("prefetchModelCreditCosts remembers what the server prices nowhere", () => {
  it("caches the priced ids, remembers the missing ones, and never asks for a missing id again", async () => {
    api.answer = { data: { "elevenlabs-v4": 30 }, missing: [UNIT] }
    await prefetchModelCreditCosts(["elevenlabs-v4", UNIT])
    expect(getCachedModelCredits("elevenlabs-v4")).toBe(30)
    expect(getCachedModelCredits(UNIT)).toBeUndefined()
    expect(isModelUnpriced(UNIT)).toBe(true)
    expect(isModelUnpriced("elevenlabs-v4")).toBe(false)

    api.answer = { data: { flux: 5 }, missing: [] }
    await prefetchModelCreditCosts([UNIT, "flux", "elevenlabs-v4"])
    expect(api.calls).toEqual([["elevenlabs-v4", UNIT], ["flux"]])
  })

  it("a batch of only remembered ids makes no request", async () => {
    rememberUnpricedModels([UNIT])
    await prefetchModelCreditCosts([UNIT])
    expect(api.calls).toEqual([])
  })

  it("a priced unit row is cached like any other price — the flag-on answer", async () => {
    api.answer = { data: { [UNIT]: 4 }, missing: [] }
    await prefetchModelCreditCosts([UNIT])
    expect(getCachedModelCredits(UNIT)).toBe(4)
    expect(isModelUnpriced(UNIT)).toBe(false)
  })
})
